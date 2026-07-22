import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, EntityManager, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { WalletService } from '../core-banking/wallet/wallet.service';
import { CreateSafiConfigDto } from './dto/create-safi-config.dto';
import { UpdateSafiConfigDto } from './dto/update-safi-config.dto';
import {
  ConfigFrequency,
  GovernanceMode,
  CardBehaviour,
  RolloverPreference,
  SafiConfig,
} from './entities/safi-config.entity';
import { CycleOutcome, SafiCycle } from './entities/safi-cycle.entity';
import {
  SafiTransaction,
  SafiTransactionType,
} from './entities/safi-transaction.entity';
import { SafiOverride, OverrideType } from './entities/safi-override.entity';

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
  spendPace: 'On Track' | 'Warning' | 'Doing Very Well';
  categories: { name: string; percent: number; amount: string; color: string }[];
  weeklySpend: { week: string; thisMonth: number; lastMonth: number }[];
  status: 'Protected' | 'On Track' | 'Warning' | 'Override Active' | 'Cycle Complete' | 'Paused';
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
    @InjectRepository(SafiOverride)
    private readonly safiOverrideRepository: Repository<SafiOverride>,
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

    const bufferAmount = dto.bufferAmount || 0;

    return this.safiConfigRepository.save(
      this.safiConfigRepository.create({
        accountNumber: dto.accountNumber,
        income: String(dto.income),
        protectedSum: String(dto.protectedSum),
        baselineBalance: wallet.balance,
        governanceMode: dto.governanceMode,
        frequency: dto.frequency,
        customDays: dto.customDays,
        expiresAt: this.computeExpiresAt(dto.frequency, new Date(), dto.customDays),
        cardBehaviour: dto.cardBehaviour || CardBehaviour.HARD_DECLINE,
        bufferAmount: String(bufferAmount),
        remainingBuffer: String(bufferAmount),
        rolloverPreference: dto.rolloverPreference || RolloverPreference.RETURN_TO_RESERVE,
      }),
    );
  }

  // Called by core-banking's WalletService before a debit is committed.
  async assertWithdrawalAllowed(
    accountNumber: string,
    prospectiveBalance: bigint,
  ): Promise<void> {
    const config = await this.findByAccountNumber(accountNumber);
    if (!config || config.isPaused) return;

    const currentBalance = await this.getCurrentBalance(config);
    const amount = currentBalance - prospectiveBalance;
    if (amount <= 0n) return;

    const protectedSum = BigInt(config.protectedSum);
    const isBreachingReserve = prospectiveBalance < protectedSum;

    if (isBreachingReserve) {
      if (config.cardBehaviour === CardBehaviour.HARD_DECLINE) {
        throw new BadRequestException(
          `Transaction declined. Your reserve of ${config.protectedSum} is protected.`,
        );
      } else if (config.cardBehaviour === CardBehaviour.BUFFER) {
        const breachAmount = protectedSum - prospectiveBalance;
        const remainingBuffer = BigInt(config.remainingBuffer);
        if (breachAmount > remainingBuffer) {
          throw new BadRequestException(
            `Transaction declined. Your transaction exceeds your remaining buffer of ${config.remainingBuffer}.`,
          );
        }
      }
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

    const isUssd = data.reference.toLowerCase().includes('ussd');
    if (config.isPaused || isUssd) return;

    if (data.type === SafiTransactionType.DEBIT) {
      const amount = BigInt(data.amount);
      const balanceAfter = BigInt(data.balanceAfter);
      const protectedSum = BigInt(config.protectedSum);
      const income = BigInt(config.income);
      const allocation = income - protectedSum;

      let triggeredOverride = false;
      let overrideType = OverrideType.AUTO_COVER;
      let overrideReason = '';

      if (balanceAfter < protectedSum) {
        if (config.cardBehaviour === CardBehaviour.BUFFER) {
          const balanceBefore = balanceAfter + amount;
          let bufferUsedByThisTx = 0n;
          if (balanceBefore < protectedSum) {
            bufferUsedByThisTx = amount;
          } else {
            bufferUsedByThisTx = protectedSum - balanceAfter;
          }

          const originalRemaining = BigInt(config.remainingBuffer);
          const updatedRemaining = originalRemaining - bufferUsedByThisTx;
          config.remainingBuffer = (updatedRemaining > 0n ? updatedRemaining : 0n).toString();
          
          if (updatedRemaining <= 0n) {
            config.cardBehaviour = CardBehaviour.HARD_DECLINE;
          }
        } else if (config.cardBehaviour === CardBehaviour.AUTO_COVER) {
          triggeredOverride = true;
          overrideType = OverrideType.AUTO_COVER;
          overrideReason = 'Auto Cover triggered: Spend Pool exhausted.';
        }
      }

      if (config.governanceMode === GovernanceMode.STRICT) {
        const { totalDays } = this.getCycleWindow(config);
        const dailySafeSpend = totalDays > 0 ? allocation / BigInt(totalDays) : 0n;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const dbOffset = await this.getDbOffset();
        const adjustedToday = new Date(today.getTime() + dbOffset);

        const transactionsToday = await repository.find({
          where: {
            accountNumber,
            type: SafiTransactionType.DEBIT,
            createdAt: MoreThanOrEqual(adjustedToday),
          },
        });

        const todayTotal = transactionsToday.reduce(
          (sum, t) => sum + BigInt(t.amount),
          0n,
        );

        if (todayTotal > dailySafeSpend) {
          triggeredOverride = true;
          overrideType = OverrideType.LIMIT_BREACH;
          overrideReason = `Daily Safe Spend of ${dailySafeSpend.toString()} exceeded.`;
        }
      }

      if (triggeredOverride) {
        config.overrideActive = true;
        const overrideRepo = manager
          ? manager.getRepository(SafiOverride)
          : this.safiOverrideRepository;

        await overrideRepo.save(
          overrideRepo.create({
            accountNumber,
            type: overrideType,
            reason: overrideReason,
            amount: data.amount,
          }),
        );
      }

      await configRepository.save(config);
    }
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
    if (dto.customDays !== undefined) {
      config.customDays = dto.customDays;
    }
    if (dto.frequency !== undefined || dto.customDays !== undefined) {
      if (dto.frequency !== undefined) config.frequency = dto.frequency;
      config.expiresAt = this.computeExpiresAt(
        config.frequency,
        new Date(),
        config.customDays,
      );
    }
    if (dto.cardBehaviour !== undefined)
      config.cardBehaviour = dto.cardBehaviour;
    if (dto.bufferAmount !== undefined) {
      config.bufferAmount = String(dto.bufferAmount);
      config.remainingBuffer = String(dto.bufferAmount);
    }
    if (dto.rolloverPreference !== undefined)
      config.rolloverPreference = dto.rolloverPreference;

    return this.safiConfigRepository.save(config);
  }

  async deactivate(accountNumber: string): Promise<{ success: boolean }> {
    const config = await this.findByAccountNumber(accountNumber);
    if (!config) {
      throw new NotFoundException(
        `No config found for account number ${accountNumber}`,
      );
    }
    await this.safiConfigRepository.delete({ accountNumber });
    return { success: true };
  }

  async getDashboard(accountNumber: string): Promise<SafiDashboard> {
    const config = await this.getByAccountNumber(accountNumber);

    const { start, end, totalDays } = this.getCycleWindow(config);
    const now = new Date();

    const dbOffset = await this.getDbOffset();
    const adjustedStart = new Date(start.getTime() + dbOffset);

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
      where: { accountNumber, createdAt: MoreThanOrEqual(adjustedStart) },
      order: { createdAt: 'ASC' },
    });

    const income = BigInt(config.income);
    const protectedSum = BigInt(config.protectedSum);
    const currentBalance = await this.getCurrentBalance(config);

    const prevCycle = await this.safiCycleRepository.findOne({
      where: { accountNumber: config.accountNumber },
      order: { endDate: 'DESC' },
    });

    let rolloverAmount = 0n;
    if (
      prevCycle &&
      config.governanceMode === GovernanceMode.FLEXIBLE &&
      config.rolloverPreference === RolloverPreference.ROLLOVER
    ) {
      const prevRemaining = BigInt(prevCycle.netAmount) + BigInt(prevCycle.allocation);
      if (prevRemaining > 0n) {
        rolloverAmount = prevRemaining;
      }
    }

    const baseAllocation = income - protectedSum;
    const allocation = baseAllocation + rolloverAmount;
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
    // Fetch override events this cycle
    const overrides = await this.safiOverrideRepository.find({
      where: {
        accountNumber,
        createdAt: MoreThanOrEqual(adjustedStart),
      },
    });
    const overrideCount = overrides.length;

    const bufferAmount = BigInt(config.bufferAmount);
    const remainingBuffer = BigInt(config.remainingBuffer);
    const bufferUsed = bufferAmount > remainingBuffer ? bufferAmount - remainingBuffer : 0n;

    let score = 100;
    score -= overrideCount * 15;
    if (config.governanceMode === GovernanceMode.STRICT && (breached || overrideCount > 0)) {
      score -= 20;
    }
    if (bufferUsed > 0n) {
      score -= 5;
    }
    if (overrideCount === 0) {
      score += 20;
    }
    const complianceScore = Math.min(Math.max(score, 0), 100);

    let spendPace: 'On Track' | 'Warning' | 'Doing Very Well' = 'On Track';
    if (actualSpendRatio < idealSpendRatio - 0.15) {
      spendPace = 'Doing Very Well';
    } else if (actualSpendRatio > idealSpendRatio + 0.05) {
      spendPace = 'Warning';
    } else {
      spendPace = 'On Track';
    }

    let status: 'Protected' | 'On Track' | 'Warning' | 'Override Active' | 'Cycle Complete' | 'Paused' = 'On Track';
    if (config.isPaused) {
      status = 'Paused';
    } else if (config.overrideActive) {
      status = 'Override Active';
    } else if (breached) {
      status = 'Warning';
    } else if (daysLeft === 0) {
      status = 'Cycle Complete';
    } else if (complianceScore < 60) {
      status = 'Warning';
    } else if (complianceScore >= 85) {
      status = 'Protected';
    } else {
      status = 'On Track';
    }

    // Fetch core banking transactions for category & weekly analysis
    const coreTransactions = await this.walletService.getTransactionsByAccountNumber(
      accountNumber,
      adjustedStart,
    );
    const debits = coreTransactions.filter((t) => t.type === 'debit');

    const categoryTotals: Record<string, bigint> = {
      'Food & Dining': 0n,
      'Transport': 0n,
      'Bills & Utilities': 0n,
      'Entertainment': 0n,
      'Other': 0n,
    };

    debits.forEach((t) => {
      const cat = this.categorizeTransaction(t.description);
      categoryTotals[cat] += BigInt(t.amount);
    });

    const categoriesList = [
      { name: 'Food & Dining', color: '#10B981' },
      { name: 'Transport', color: '#3B82F6' },
      { name: 'Bills & Utilities', color: '#EF4444' },
      { name: 'Entertainment', color: '#FBBF24' },
      { name: 'Other', color: '#8B5CF6' }
    ].map((cat) => {
      const amount = categoryTotals[cat.name] || 0n;
      const pct = allocation > 0n ? Math.round((Number(amount) / Number(allocation)) * 100) : 0;
      return {
        name: cat.name,
        percent: pct,
        amount: amount.toString(),
        color: cat.color,
      };
    });

    const weeklySpendThisMonth = [0n, 0n, 0n, 0n];
    debits.forEach((t) => {
      const ageInDays = Math.floor((t.createdAt.getTime() - start.getTime()) / MS_PER_DAY);
      if (ageInDays < 7) {
        weeklySpendThisMonth[0] += BigInt(t.amount);
      } else if (ageInDays < 14) {
        weeklySpendThisMonth[1] += BigInt(t.amount);
      } else if (ageInDays < 21) {
        weeklySpendThisMonth[2] += BigInt(t.amount);
      } else {
        weeklySpendThisMonth[3] += BigInt(t.amount);
      }
    });



    const weeklySpendLastMonth = [0n, 0n, 0n, 0n];
    if (prevCycle) {
      const prevTransactions = await this.walletService.getTransactionsByAccountNumber(
        accountNumber,
        prevCycle.startDate,
        prevCycle.endDate,
      );
      const prevDebits = prevTransactions.filter((t) => t.type === 'debit');
      prevDebits.forEach((t) => {
        const ageInDays = Math.floor(
          (t.createdAt.getTime() - prevCycle.startDate.getTime()) / MS_PER_DAY,
        );
        if (ageInDays < 7) {
          weeklySpendLastMonth[0] += BigInt(t.amount);
        } else if (ageInDays < 14) {
          weeklySpendLastMonth[1] += BigInt(t.amount);
        } else if (ageInDays < 21) {
          weeklySpendLastMonth[2] += BigInt(t.amount);
        } else {
          weeklySpendLastMonth[3] += BigInt(t.amount);
        }
      });
    }

    const weeklySpend = [
      {
        week: 'Wk 1',
        thisMonth: Number(weeklySpendThisMonth[0]) / 100,
        lastMonth: prevCycle
          ? Number(weeklySpendLastMonth[0]) / 100
          : Math.round((Number(allocation) * 0.15) / 100),
      },
      {
        week: 'Wk 2',
        thisMonth: Number(weeklySpendThisMonth[1]) / 100,
        lastMonth: prevCycle
          ? Number(weeklySpendLastMonth[1]) / 100
          : Math.round((Number(allocation) * 0.2) / 100),
      },
      {
        week: 'Wk 3',
        thisMonth: Number(weeklySpendThisMonth[2]) / 100,
        lastMonth: prevCycle
          ? Number(weeklySpendLastMonth[2]) / 100
          : Math.round((Number(allocation) * 0.25) / 100),
      },
      {
        week: 'Wk 4',
        thisMonth: Number(weeklySpendThisMonth[3]) / 100,
        lastMonth: prevCycle
          ? Number(weeklySpendLastMonth[3]) / 100
          : Math.round((Number(allocation) * 0.1) / 100),
      },
    ];

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
      spendPace,
      categories: categoriesList,
      weeklySpend,
      status,
    };
  }

  private categorizeTransaction(description: string | null): string {
    if (!description) return 'Other';
    const desc = description.toLowerCase();

    if (
      desc.includes('restaurant') ||
      desc.includes('food') ||
      desc.includes('dining') ||
      desc.includes('eats') ||
      desc.includes('grocery') ||
      desc.includes('groceries') ||
      desc.includes('supermarket') ||
      desc.includes('canteen') ||
      desc.includes('kitchen') ||
      desc.includes('kfc') ||
      desc.includes('buka') ||
      desc.includes('chow') ||
      desc.includes('eat')
    ) {
      return 'Food & Dining';
    }

    if (
      desc.includes('uber') ||
      desc.includes('bolt') ||
      desc.includes('taxify') ||
      desc.includes('transport') ||
      desc.includes('bus') ||
      desc.includes('train') ||
      desc.includes('flight') ||
      desc.includes('airline') ||
      desc.includes('fuel') ||
      desc.includes('petrol') ||
      desc.includes('ride')
    ) {
      return 'Transport';
    }

    if (
      desc.includes('rent') ||
      desc.includes('electric') ||
      desc.includes('power') ||
      desc.includes('water') ||
      desc.includes('bill') ||
      desc.includes('utilities') ||
      desc.includes('dstv') ||
      desc.includes('gotv') ||
      desc.includes('startimes') ||
      desc.includes('recharge') ||
      desc.includes('airtime') ||
      desc.includes('mtn') ||
      desc.includes('airtel') ||
      desc.includes('glo') ||
      desc.includes('9mobile') ||
      desc.includes('data')
    ) {
      return 'Bills & Utilities';
    }

    if (
      desc.includes('netflix') ||
      desc.includes('spotify') ||
      desc.includes('youtube') ||
      desc.includes('prime') ||
      desc.includes('cinema') ||
      desc.includes('showmax') ||
      desc.includes('ticket') ||
      desc.includes('game') ||
      desc.includes('movie') ||
      desc.includes('entertainment') ||
      desc.includes('club')
    ) {
      return 'Entertainment';
    }

    return 'Other';
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

    if (config.isPaused && config.pauseStartedAt) {
      const nowTime = now.getTime();
      const pauseStart = new Date(config.pauseStartedAt).getTime();
      const pausedDays = (nowTime - pauseStart) / MS_PER_DAY;
      if (pausedDays >= 14) {
        config.isPaused = false;
        config.pauseStartedAt = null;
        await this.safiConfigRepository.save(config);
      }
    }

    let rolled = false;

    for (
      let iterations = 0;
      now >= config.expiresAt && iterations < MAX_ROLLOVER_ITERATIONS;
      iterations++
    ) {
      const { start, end } = this.getCycleWindow(config);
      await this.closeCycle(config, start, end);
      config.expiresAt = this.computeExpiresAt(
        config.frequency,
        end,
        config.customDays,
      );
      rolled = true;
    }

    if (rolled) {
      config.remainingBuffer = config.bufferAmount;
      config.overrideActive = false;
      return this.safiConfigRepository.save(config);
    }

    return config;
  }

  private async closeCycle(
    config: SafiConfig,
    start: Date,
    end: Date,
  ): Promise<void> {
    const income = BigInt(config.income);
    const protectedSum = BigInt(config.protectedSum);

    const prevCycle = await this.safiCycleRepository.findOne({
      where: { accountNumber: config.accountNumber },
      order: { endDate: 'DESC' },
    });

    let rolloverAmount = 0n;
    if (
      prevCycle &&
      config.governanceMode === GovernanceMode.FLEXIBLE &&
      config.rolloverPreference === RolloverPreference.ROLLOVER
    ) {
      const prevRemaining = BigInt(prevCycle.netAmount) + BigInt(prevCycle.allocation);
      if (prevRemaining > 0n) {
        rolloverAmount = prevRemaining;
      }
    }

    const baseAllocation = income - protectedSum;
    const allocation = baseAllocation + rolloverAmount;

    const dbOffset = await this.getDbOffset();
    const adjustedStart = new Date(start.getTime() + dbOffset);
    const adjustedEnd = new Date(end.getTime() + dbOffset);

    const balanceAtEnd = await this.getBalanceAsOf(config, end);
    const transactionsThisCycle = await this.safiTransactionRepository.find({
      where: {
        accountNumber: config.accountNumber,
        createdAt: Between(adjustedStart, adjustedEnd),
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

    const overrides = await this.safiOverrideRepository.find({
      where: {
        accountNumber: config.accountNumber,
        createdAt: Between(adjustedStart, adjustedEnd),
      },
    });
    const overrideCount = overrides.length;

    const bufferAmount = BigInt(config.bufferAmount);
    const remainingBuffer = BigInt(config.remainingBuffer);
    const bufferUsed = bufferAmount > remainingBuffer ? bufferAmount - remainingBuffer : 0n;

    let score = 100;
    score -= overrideCount * 15;
    if (config.governanceMode === GovernanceMode.STRICT && (breached || overrideCount > 0)) {
      score -= 20;
    }
    if (bufferUsed > 0n) {
      score -= 5;
    }
    if (overrideCount === 0) {
      score += 20;
    }
    const complianceScore = Math.min(Math.max(score, 0), 100);

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
        overrideCount,
        bufferUsed: bufferUsed.toString(),
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
    const dbOffset = await this.getDbOffset();
    const adjustedAsOf = new Date(asOf.getTime() + dbOffset);
    const latest = await this.safiTransactionRepository.findOne({
      where: {
        accountNumber: config.accountNumber,
        createdAt: LessThanOrEqual(adjustedAsOf),
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
      case ConfigFrequency.BIWEEKLY:
        start.setDate(start.getDate() - 14);
        break;
      case ConfigFrequency.MONTHLY:
        start.setMonth(start.getMonth() - 1);
        break;
      case ConfigFrequency.CUSTOM:
        start.setDate(start.getDate() - (config.customDays || 30));
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

  private computeExpiresAt(
    frequency: ConfigFrequency,
    from: Date,
    customDays?: number,
  ): Date {
    const expiresAt = new Date(from);
    switch (frequency) {
      case ConfigFrequency.DAILY:
        expiresAt.setDate(expiresAt.getDate() + 1);
        break;
      case ConfigFrequency.WEEKLY:
        expiresAt.setDate(expiresAt.getDate() + 7);
        break;
      case ConfigFrequency.BIWEEKLY:
        expiresAt.setDate(expiresAt.getDate() + 14);
        break;
      case ConfigFrequency.MONTHLY:
        expiresAt.setMonth(expiresAt.getMonth() + 1);
        break;
      case ConfigFrequency.CUSTOM:
        expiresAt.setDate(expiresAt.getDate() + (customDays || 30));
        break;
    }
    return expiresAt;
  }

  private async getDbOffset(): Promise<number> {
    try {
      const result = await this.safiConfigRepository.query('SELECT CURRENT_TIMESTAMP() as now');
      if (result && result[0] && result[0].now) {
        const dbNow = new Date(result[0].now);
        const appNow = new Date();
        return dbNow.getTime() - appNow.getTime();
      }
    } catch (err) {
      console.error('Failed to get DB time offset:', err);
    }
    return 0;
  }

  async pause(accountNumber: string): Promise<SafiConfig> {
    const config = await this.getByAccountNumber(accountNumber);
    if (config.pauseCountThisYear >= 3) {
      throw new BadRequestException('Maximum of 3 pauses per calendar year exceeded.');
    }
    config.isPaused = true;
    config.pauseCountThisYear += 1;
    config.pauseStartedAt = new Date();
    return this.safiConfigRepository.save(config);
  }

  async resume(accountNumber: string): Promise<SafiConfig> {
    const config = await this.getByAccountNumber(accountNumber);
    config.isPaused = false;
    config.pauseStartedAt = null;
    return this.safiConfigRepository.save(config);
  }

  async manualOverride(
    accountNumber: string,
    reason: string,
    amount: string,
  ): Promise<SafiConfig> {
    const config = await this.getByAccountNumber(accountNumber);
    config.overrideActive = true;

    await this.safiOverrideRepository.save(
      this.safiOverrideRepository.create({
        accountNumber,
        type: OverrideType.MANUAL,
        reason,
        amount,
      }),
    );

    return this.safiConfigRepository.save(config);
  }

  async getProjection(accountNumber: string): Promise<{ month3: string; month6: string; month12: string }> {
    const config = await this.getByAccountNumber(accountNumber);
    
    // Fetch completed cycles to calculate average savings
    const cycles = await this.safiCycleRepository.find({
      where: { accountNumber },
      order: { endDate: 'DESC' },
      take: 6, // look back up to 6 cycles
    });

    const income = BigInt(config.income);
    const protectedSum = BigInt(config.protectedSum);
    const allocation = income - protectedSum;
    
    let avgSavingsPerCycle = 0n;
    if (cycles.length > 0) {
      let totalSavings = 0n;
      cycles.forEach((c) => {
        const remaining = BigInt(c.netAmount) + BigInt(c.allocation);
        if (remaining > 0n) {
          totalSavings += remaining;
        }
      });
      avgSavingsPerCycle = totalSavings / BigInt(cycles.length);
    } else {
      // Default baseline: assume 10% of spend pool is saved
      avgSavingsPerCycle = allocation / 10n;
    }

    // Convert cycle savings to monthly projection
    let monthlySavings = 0n;
    switch (config.frequency) {
      case ConfigFrequency.DAILY:
        monthlySavings = avgSavingsPerCycle * 30n;
        break;
      case ConfigFrequency.WEEKLY:
        monthlySavings = (avgSavingsPerCycle * 52n) / 12n;
        break;
      case ConfigFrequency.BIWEEKLY:
        monthlySavings = (avgSavingsPerCycle * 26n) / 12n;
        break;
      case ConfigFrequency.MONTHLY:
        monthlySavings = avgSavingsPerCycle;
        break;
      case ConfigFrequency.CUSTOM:
        const days = BigInt(config.customDays || 30);
        monthlySavings = days > 0n ? (avgSavingsPerCycle * 30n) / days : avgSavingsPerCycle;
        break;
    }

    const currentReserve = BigInt(config.protectedSum);
    const month3 = (currentReserve + monthlySavings * 3n).toString();
    const month6 = (currentReserve + monthlySavings * 6n).toString();
    const month12 = (currentReserve + monthlySavings * 12n).toString();

    return { month3, month6, month12 };
  }
}
