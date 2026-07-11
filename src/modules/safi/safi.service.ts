import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, EntityManager, LessThanOrEqual, Repository } from 'typeorm';
import { WalletService } from '../core-banking/wallet/wallet.service';
import { CreateSafiConfigDto } from './dto/create-safi-config.dto';
import { UpdateSafiConfigDto } from './dto/update-safi-config.dto';
import {
  ConfigFrequency,
  GovernanceMode,
  SafiConfig,
} from './entities/safi-config.entity';
import { CycleOutcome, SafiCycle } from './entities/safi-cycle.entity';
import {
  SafiTransaction,
  SafiTransactionType,
} from './entities/safi-transaction.entity';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_ROLLOVER_ITERATIONS = 1000;
const HISTORY_LIMIT = 12;

export interface SafiDashboard {
  cycle: { label: string; day: number; totalDays: number; daysLeft: number };
  remaining: { amount: string; percent: number };
  dailyRate: string;
  safeDaily: string;
  runsOutOn: Date;
  spend: { allocation: string; used: string };
  protected: { amount: string; status: 'untouched' | 'breached'; days: number };
  rulesMaintainedDays: number;
  complianceScore: number;
}

export interface SafiCycleSummary {
  period: string;
  status: 'active' | 'completed';
  percentRemaining?: number;
  outcome?: CycleOutcome;
  netAmount?: string;
  protectedAmount: string;
  complianceScore: number;
}

export interface SafiHistory {
  complianceStreakDays: number;
  cycles: SafiCycleSummary[];
}

@Injectable()
export class SafiService {
  constructor(
    @InjectRepository(SafiConfig)
    private readonly safiConfigRepository: Repository<SafiConfig>,
    @InjectRepository(SafiCycle)
    private readonly safiCycleRepository: Repository<SafiCycle>,
    @InjectRepository(SafiTransaction)
    private readonly safiTransactionRepository: Repository<SafiTransaction>,
    @Inject(forwardRef(() => WalletService))
    private readonly walletService: WalletService,
  ) {}

  async create(dto: CreateSafiConfigDto): Promise<SafiConfig> {
    const existing = await this.findByAccountNumber(dto.accountNumber);
    if (existing) {
      throw new ConflictException(
        `A config already exists for account number ${dto.accountNumber}`,
      );
    }

    const wallet = await this.walletService.findByAccountNumber(
      dto.accountNumber,
    );
    if (!wallet) {
      throw new BadRequestException(
        `No wallet found for account number ${dto.accountNumber}`,
      );
    }

    this.assertProtectedSumWithinIncome(dto.income, dto.protectedSum);

    return this.safiConfigRepository.save(
      this.safiConfigRepository.create({
        accountNumber: dto.accountNumber,
        income: String(dto.income),
        protectedSum: String(dto.protectedSum),
        baselineBalance: wallet.balance,
        governanceMode: dto.governanceMode,
        frequency: dto.frequency,
        expiresAt: this.computeExpiresAt(dto.frequency, new Date()),
      }),
    );
  }

  // Called by core-banking's WalletService before a debit is committed.
  async assertWithdrawalAllowed(
    accountNumber: string,
    prospectiveBalance: bigint,
  ): Promise<void> {
    const config = await this.findByAccountNumber(accountNumber);
    if (!config) return;

    const protectedSum = BigInt(config.protectedSum);
    if (prospectiveBalance >= protectedSum) return;

    if (config.governanceMode === GovernanceMode.STRICT) {
      throw new BadRequestException(
        `This withdrawal would drop your balance below your protected amount of ${config.protectedSum}`,
      );
    }
  }

  // Called by core-banking's WalletService after a transaction clears, to keep Safi's own copy of the ledger.
  async recordTransaction(
    accountNumber: string,
    data: {
      type: SafiTransactionType;
      amount: string;
      balanceAfter: string;
      reference: string;
    },
    manager?: EntityManager,
  ): Promise<void> {
    const configRepository = manager
      ? manager.getRepository(SafiConfig)
      : this.safiConfigRepository;
    const config = await configRepository.findOne({ where: { accountNumber } });
    if (!config) return;

    const repository = manager
      ? manager.getRepository(SafiTransaction)
      : this.safiTransactionRepository;

    await repository.save(repository.create({ accountNumber, ...data }));
  }

  findByAccountNumber(accountNumber: string): Promise<SafiConfig | null> {
    return this.safiConfigRepository.findOne({ where: { accountNumber } });
  }

  async getByAccountNumber(accountNumber: string): Promise<SafiConfig> {
    const config = await this.findByAccountNumber(accountNumber);
    if (!config) {
      throw new NotFoundException(
        `No config found for account number ${accountNumber}`,
      );
    }
    return this.ensureCurrentCycle(config);
  }

  async update(
    accountNumber: string,
    dto: UpdateSafiConfigDto,
  ): Promise<SafiConfig> {
    const config = await this.getByAccountNumber(accountNumber);

    const income = dto.income ?? Number(config.income);
    const protectedSum = dto.protectedSum ?? Number(config.protectedSum);
    this.assertProtectedSumWithinIncome(income, protectedSum);

    if (dto.income !== undefined) config.income = String(dto.income);
    if (dto.protectedSum !== undefined)
      config.protectedSum = String(dto.protectedSum);
    if (dto.governanceMode !== undefined)
      config.governanceMode = dto.governanceMode;
    if (dto.frequency !== undefined) {
      config.frequency = dto.frequency;
      config.expiresAt = this.computeExpiresAt(dto.frequency, new Date());
    }

    return this.safiConfigRepository.save(config);
  }

  async getDashboard(accountNumber: string): Promise<SafiDashboard> {
    const config = await this.getByAccountNumber(accountNumber);

    const { start, end, totalDays } = this.getCycleWindow(config);
    const now = new Date();

    const dayOfCycle = Math.min(
      Math.max(
        Math.floor((now.getTime() - start.getTime()) / MS_PER_DAY) + 1,
        1,
      ),
      totalDays,
    );
    const daysLeft = Math.max(
      Math.ceil((end.getTime() - now.getTime()) / MS_PER_DAY),
      0,
    );

    const transactionsThisCycle = await this.safiTransactionRepository.find({
      where: { accountNumber, createdAt: Between(start, now) },
      order: { createdAt: 'ASC' },
    });

    const income = BigInt(config.income);
    const protectedSum = BigInt(config.protectedSum);
    const currentBalance = await this.getCurrentBalance(config);

    const allocation = income - protectedSum;
    const remaining =
      currentBalance > protectedSum ? currentBalance - protectedSum : 0n;
    const used = allocation > remaining ? allocation - remaining : 0n;

    const breached =
      currentBalance < protectedSum ||
      transactionsThisCycle.some((t) => BigInt(t.balanceAfter) < protectedSum);

    const dailyRate = totalDays > 0 ? allocation / BigInt(totalDays) : 0n;
    const safeDaily = daysLeft > 0 ? remaining / BigInt(daysLeft) : remaining;

    const velocity = used / BigInt(Math.max(dayOfCycle, 1));
    let runsOutOn = end;
    if (velocity > 0n) {
      const daysUntilDepletion = Number(remaining / velocity);
      const projected = new Date(
        now.getTime() + daysUntilDepletion * MS_PER_DAY,
      );
      if (projected < end) runsOutOn = projected;
    }

    const percent =
      allocation > 0n
        ? Math.round((Number(remaining) / Number(allocation)) * 100)
        : 0;

    const untouchedDays = breached ? 0 : dayOfCycle;

    const idealSpendRatio = dayOfCycle / totalDays;
    const actualSpendRatio =
      allocation > 0n ? Number(used) / Number(allocation) : 0;
    const pacingScore = Math.max(
      0,
      1 - Math.abs(actualSpendRatio - idealSpendRatio),
    );
    const complianceScore = Math.round((breached ? 0 : 60) + pacingScore * 40);

    return {
      cycle: {
        label: `${start.toLocaleString('en-US', { month: 'long' }).toUpperCase()} CYCLE`,
        day: dayOfCycle,
        totalDays,
        daysLeft,
      },
      remaining: { amount: remaining.toString(), percent },
      dailyRate: dailyRate.toString(),
      safeDaily: safeDaily.toString(),
      runsOutOn,
      spend: { allocation: allocation.toString(), used: used.toString() },
      protected: {
        amount: protectedSum.toString(),
        status: breached ? 'breached' : 'untouched',
        days: untouchedDays,
      },
      rulesMaintainedDays: untouchedDays,
      complianceScore,
    };
  }

  async getHistory(accountNumber: string): Promise<SafiHistory> {
    const config = await this.getByAccountNumber(accountNumber);
    const dashboard = await this.getDashboard(accountNumber);

    const completedCycles = await this.safiCycleRepository.find({
      where: { accountNumber },
      order: { startDate: 'DESC' },
      take: HISTORY_LIMIT,
    });

    const { start } = this.getCycleWindow(config);
    const activeCycle: SafiCycleSummary = {
      period: this.formatPeriodLabel(start),
      status: 'active',
      percentRemaining: dashboard.remaining.percent,
      protectedAmount: dashboard.protected.amount,
      complianceScore: dashboard.complianceScore,
    };

    return {
      complianceStreakDays: dashboard.rulesMaintainedDays,
      cycles: [
        activeCycle,
        ...completedCycles.map((cycle) => ({
          period: this.formatPeriodLabel(cycle.startDate),
          status: 'completed' as const,
          outcome: cycle.outcome,
          netAmount: cycle.netAmount,
          protectedAmount: cycle.protectedSum,
          complianceScore: cycle.complianceScore,
        })),
      ],
    };
  }

  private async ensureCurrentCycle(config: SafiConfig): Promise<SafiConfig> {
    const now = new Date();
    let rolled = false;

    for (
      let iterations = 0;
      now >= config.expiresAt && iterations < MAX_ROLLOVER_ITERATIONS;
      iterations++
    ) {
      const { start, end } = this.getCycleWindow(config);
      await this.closeCycle(config, start, end);
      config.expiresAt = this.computeExpiresAt(config.frequency, end);
      rolled = true;
    }

    return rolled ? this.safiConfigRepository.save(config) : config;
  }

  private async closeCycle(
    config: SafiConfig,
    start: Date,
    end: Date,
  ): Promise<void> {
    const income = BigInt(config.income);
    const protectedSum = BigInt(config.protectedSum);
    const allocation = income - protectedSum;

    const balanceAtEnd = await this.getBalanceAsOf(config, end);
    const transactionsThisCycle = await this.safiTransactionRepository.find({
      where: {
        accountNumber: config.accountNumber,
        createdAt: Between(start, end),
      },
      order: { createdAt: 'ASC' },
    });

    const remaining =
      balanceAtEnd > protectedSum ? balanceAtEnd - protectedSum : 0n;
    const used = allocation > remaining ? allocation - remaining : 0n;
    const netAmount = remaining - allocation;

    const breached =
      balanceAtEnd < protectedSum ||
      transactionsThisCycle.some((t) => BigInt(t.balanceAfter) < protectedSum);

    const actualSpendRatio =
      allocation > 0n ? Number(used) / Number(allocation) : 0;
    const pacingScore = Math.max(0, 1 - Math.abs(actualSpendRatio - 1));
    const complianceScore = Math.round((breached ? 0 : 60) + pacingScore * 40);

    const outcome =
      netAmount > 0n
        ? CycleOutcome.RETURNED
        : netAmount < 0n
          ? CycleOutcome.OVER_BUDGET
          : CycleOutcome.EXACT;

    await this.safiCycleRepository.save(
      this.safiCycleRepository.create({
        accountNumber: config.accountNumber,
        startDate: start,
        endDate: end,
        income: income.toString(),
        protectedSum: protectedSum.toString(),
        allocation: allocation.toString(),
        netAmount: netAmount.toString(),
        complianceScore,
        outcome,
      }),
    );
  }

  private async getCurrentBalance(config: SafiConfig): Promise<bigint> {
    const latest = await this.safiTransactionRepository.findOne({
      where: { accountNumber: config.accountNumber },
      order: { createdAt: 'DESC' },
    });
    return latest
      ? BigInt(latest.balanceAfter)
      : BigInt(config.baselineBalance);
  }

  private async getBalanceAsOf(
    config: SafiConfig,
    asOf: Date,
  ): Promise<bigint> {
    const latest = await this.safiTransactionRepository.findOne({
      where: {
        accountNumber: config.accountNumber,
        createdAt: LessThanOrEqual(asOf),
      },
      order: { createdAt: 'DESC' },
    });
    return latest
      ? BigInt(latest.balanceAfter)
      : BigInt(config.baselineBalance);
  }

  private formatPeriodLabel(date: Date): string {
    return date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  }

  private getCycleWindow(config: SafiConfig): {
    start: Date;
    end: Date;
    totalDays: number;
  } {
    const end = config.expiresAt;
    const start = new Date(end);
    switch (config.frequency) {
      case ConfigFrequency.DAILY:
        start.setDate(start.getDate() - 1);
        break;
      case ConfigFrequency.WEEKLY:
        start.setDate(start.getDate() - 7);
        break;
      case ConfigFrequency.MONTHLY:
        start.setMonth(start.getMonth() - 1);
        break;
    }
    const totalDays = Math.round(
      (end.getTime() - start.getTime()) / MS_PER_DAY,
    );
    return { start, end, totalDays };
  }

  private assertProtectedSumWithinIncome(
    income: number,
    protectedSum: number,
  ): void {
    if (protectedSum > income) {
      throw new BadRequestException(
        'protectedSum cannot be greater than income',
      );
    }
  }

  private computeExpiresAt(frequency: ConfigFrequency, from: Date): Date {
    const expiresAt = new Date(from);
    switch (frequency) {
      case ConfigFrequency.DAILY:
        expiresAt.setDate(expiresAt.getDate() + 1);
        break;
      case ConfigFrequency.WEEKLY:
        expiresAt.setDate(expiresAt.getDate() + 7);
        break;
      case ConfigFrequency.MONTHLY:
        expiresAt.setMonth(expiresAt.getMonth() + 1);
        break;
    }
    return expiresAt;
  }
}
