import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
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
import { SafiRule } from './entities/safi-rule.entity';
import { SafiControl } from './entities/safi-control.entity';
import { SafiAuditLog } from './entities/safi-audit-log.entity';
import { Transaction } from '../core-banking/wallet/entities/transaction.entity';
import * as fs from 'fs';
import * as path from 'path';

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
  allocation?: string;
  overrideCount?: number;
  endDate?: Date;
}

export interface SafiHistory {
  complianceStreakDays: number;
  cycles: SafiCycleSummary[];
}

@Injectable()
export class SafiService implements OnModuleInit {
  constructor(
    @InjectRepository(SafiConfig)
    private readonly safiConfigRepository: Repository<SafiConfig>,
    @InjectRepository(SafiCycle)
    private readonly safiCycleRepository: Repository<SafiCycle>,
    @InjectRepository(SafiTransaction)
    private readonly safiTransactionRepository: Repository<SafiTransaction>,
    @InjectRepository(SafiOverride)
    private readonly safiOverrideRepository: Repository<SafiOverride>,
    @InjectRepository(SafiRule)
    private readonly safiRuleRepository: Repository<SafiRule>,
    @InjectRepository(SafiControl)
    private readonly safiControlRepository: Repository<SafiControl>,
    @InjectRepository(SafiAuditLog)
    private readonly safiAuditLogRepository: Repository<SafiAuditLog>,
    @Inject(forwardRef(() => WalletService))
    private readonly walletService: WalletService,
  ) {}

  async onModuleInit() {
    await this.seedRulesAndControls();
  }

  private async seedRulesAndControls() {
    const ruleCount = await this.safiRuleRepository.count();
    if (ruleCount === 0) {
      await this.safiRuleRepository.save([
        {
          name: 'Standard Allocation Cycle — 30-day',
          description: 'Allocation + protection enforced at transaction layer · All account tiers',
          status: 'ACTIVE',
          accounts: 12847,
        },
        {
          name: 'Hard Decline Override Threshold',
          description: 'Card blocked when allocation exhausted · Strict governance tier',
          status: 'ACTIVE',
          accounts: 3201,
        },
        {
          name: 'Salary-Linked Allocation Trigger',
          description: 'Auto-activates allocation rules on salary credit event · Premium tier',
          status: 'INACTIVE',
          accounts: 580,
        },
        {
          name: 'High-Volume Transaction Alert',
          description: 'Flag transactions above N5,000,000 · Strict governance tier',
          status: 'ACTIVE',
          accounts: 3254,
        },
      ]);
    }

    const controlCount = await this.safiControlRepository.count();
    if (controlCount === 0) {
      await this.safiControlRepository.save({
        governanceMode: 'Flexible',
        allowedBehaviours: ['Hard Decline', 'Auto Cover', 'Buffer'],
        activeModes: ['Flexible', 'Strict'],
        modeConfigurations: {
          Flexible: {
            status: 'ACTIVE',
            allowedBehaviours: ['Hard Decline', 'Auto Cover', 'Buffer'],
            description: 'Flexible allocation with auto-cover and optional buffer protection'
          },
          Strict: {
            status: 'ACTIVE',
            allowedBehaviours: ['Hard Decline', 'Auto Cover'],
            description: 'Strict balance & daily safe-spend enforcement'
          }
        }
      });
    }

    const logCount = await this.safiAuditLogRepository.count();
    if (logCount === 0) {
      await this.safiAuditLogRepository.save([
        {
          actor: 'System Engine',
          action: 'Auto-synced 3 active governance rule schemas from primary vault.',
        },
        {
          actor: 'Admin (aboajah)',
          action: 'Configured "Salary-Linked Allocation Trigger" and deployed to Premium tier.',
        },
        {
          actor: 'Compliance Officer',
          action: 'Updated "Hard Decline Override Threshold" rules boundary.',
        },
      ]);
    }
  }

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
          allocation: cycle.allocation,
          overrideCount: cycle.overrideCount,
          endDate: cycle.endDate,
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

  // Admin and Institutional Endpoints Logic
  private getSettingsPath(): string {
    return path.join(process.cwd(), 'safi-admin-settings.json');
  }

  private async readSettings(): Promise<any> {
    const filePath = this.getSettingsPath();
    let settings: any = {};
    if (!fs.existsSync(filePath)) {
      settings = {};
    } else {
      try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        settings = JSON.parse(content);
      } catch (e) {
        settings = {};
      }
    }

    let modified = false;
    if (!settings.rules) {
      settings.rules = [
        {
          id: 1,
          name: 'Standard Allocation Cycle — 30-day',
          description: 'Allocation + protection enforced at transaction layer · All account tiers',
          status: 'ACTIVE',
          accounts: 12847
        },
        {
          id: 2,
          name: 'Hard Decline Override Threshold',
          description: 'Card blocked when allocation exhausted · Strict governance tier',
          status: 'ACTIVE',
          accounts: 3201
        },
        {
          id: 3,
          name: 'Salary-Linked Allocation Trigger',
          description: 'Auto-activates allocation rules on salary credit event · Premium tier',
          status: 'PILOT',
          accounts: 580
        }
      ];
      modified = true;
    }

    if (!settings.controls) {
      settings.controls = {
        governanceMode: 'Flexible',
        allowedBehaviours: ['Hard Decline', 'Auto Cover', 'Buffer'],
        activeModes: ['Flexible', 'Strict']
      };
      modified = true;
    } else if (!settings.controls.activeModes) {
      settings.controls.activeModes = ['Flexible', 'Strict'];
      modified = true;
    }

    if (!settings.auditLogs) {
      settings.auditLogs = [
        { id: 1, actor: 'System Engine', action: 'Auto-synced 3 active governance rule schemas from primary vault.', timestamp: '12 mins ago' },
        { id: 2, actor: 'Admin (aboajah)', action: 'Configured "Salary-Linked Allocation Trigger" and deployed to Premium tier.', timestamp: '2 hours ago' },
        { id: 3, actor: 'Compliance Officer', action: 'Updated "Hard Decline Override Threshold" rules boundary.', timestamp: '1 day ago' }
      ];
      modified = true;
    }

    if (!settings.systemStatus) {
      settings.systemStatus = {
        coreBanking: 'CONNECTED',
        decisionLayer: 'ACTIVE',
        allocationEngine: 'ACTIVE',
        behaviouralAnalytics: 'SYNCING'
      };
      modified = true;
    }

    if (!settings.deployments) {
      settings.deployments = {
        clusters: [
          { name: 'Production', version: 'v2.4.1 · Active', status: 'Connected', latency: '14ms', decisionLatency: '4ms', settlementHold: '22ms', healthRate: '100%' },
          { name: 'Staging', version: 'v2.4.2-rc1', status: 'Connected', latency: '18ms', decisionLatency: '5ms', settlementHold: '25ms', healthRate: '98%' },
          { name: 'Sandbox', version: 'v2.5.0-beta', status: 'Connected', latency: '24ms', decisionLatency: '6ms', settlementHold: '30ms', healthRate: '100%' }
        ]
      };
      modified = true;
    }

    if (!settings.analytics) {
      settings.analytics = {
        trendData: [
          { month: 'Jun', val: 2.1, accounts: 6400 },
          { month: 'Jul', val: 2.3, accounts: 7100 },
          { month: 'Aug', val: 2.6, accounts: 8000 },
          { month: 'Sep', val: 2.9, accounts: 8900 },
          { month: 'Oct', val: 3.1, accounts: 9500 },
          { month: 'Nov', val: 3.2, accounts: 10100 },
          { month: 'Dec', val: 3.5, accounts: 11000 },
          { month: 'Jan', val: 3.4, accounts: 10800 },
          { month: 'Feb', val: 3.6, accounts: 11300 },
          { month: 'Mar', val: 3.8, accounts: 12000 },
          { month: 'Apr', val: 3.9, accounts: 12400 },
          { month: 'May', val: 4.1, accounts: 12847 }
        ],
        ruleTriggers: {
          standardAllocation: 62,
          hardDecline: 28,
          salaryLinked: 10
        },
        depositRetentionCurve: {
          protectedTotal: '₦2.84B',
          averageDays: '28.4 Days',
          breachLeakage: '1.42%'
        }
      };
      modified = true;
    }

    if (!settings.compliance) {
      settings.compliance = {
        reports: [
          { period: 'May 2026', index: 78.4, accounts: 12847, overrides: 142, status: 'Completed' },
          { period: 'April 2026', index: 81.2, accounts: 12400, overrides: 121, status: 'Completed' },
          { period: 'March 2026', index: 79.5, accounts: 12000, overrides: 135, status: 'Completed' },
          { period: 'February 2026', index: 82.0, accounts: 11300, overrides: 110, status: 'Completed' },
          { period: 'January 2026', index: 84.6, accounts: 10800, overrides: 98, status: 'Completed' }
        ],
        checkpoints: [
          { name: 'CBN Ledgers Protection Guideline', status: 'Certified' },
          { name: 'Lagos Settlement Board Audit', status: 'Passed' },
          { name: 'Valeris Decision Engine Sandbox', status: 'Audited' }
        ],
        webhookUrl: 'https://api.novabank.com/v1/compliance/safi-exports',
        webhookFreq: 'monthly'
      };
      modified = true;
    }

    if (modified) {
      await this.writeSettings(settings);
    }

    return settings;
  }

  private async writeSettings(settings: any): Promise<void> {
    const filePath = this.getSettingsPath();
    await fs.promises.writeFile(filePath, JSON.stringify(settings, null, 2), 'utf-8');
  }

  async getAdminDashboard(): Promise<any> {
    const activeAccountsCount = await this.safiConfigRepository.count({ where: { isPaused: false } });
    
    // Sum governed funds from DB configs (in Naira)
    const configs = await this.safiConfigRepository.find();
    let totalIncomeBig = 0n;
    configs.forEach(c => {
      totalIncomeBig += BigInt(c.income || 0);
    });
    const governedFundsVal = totalIncomeBig > 0n 
      ? Number(totalIncomeBig) / 100 
      : 4100000000; // Fallback to mockup value if db is empty

    // Compliance Index and Deposit Retention from DB completed cycles
    const cycles = await this.safiCycleRepository.find();
    const complianceIndex = cycles.length > 0
      ? parseFloat((cycles.reduce((sum, c) => sum + c.complianceScore, 0) / cycles.length).toFixed(1))
      : 78.4;
      
    const breachedCycles = cycles.filter(c => c.outcome === CycleOutcome.OVER_BUDGET).length;
    const depositRetention = cycles.length > 0
      ? parseFloat(((cycles.length - breachedCycles) / cycles.length * 100).toFixed(1))
      : 81.2;

    // Override Rate
    const totalOverrides = await this.safiOverrideRepository.count();
    const totalTransactions = await this.safiTransactionRepository.count();
    const overrideRate = totalTransactions > 0
      ? parseFloat((totalOverrides / totalTransactions * 100).toFixed(1))
      : 7.3;

    const hardDeclineCount = configs.filter(c => c.cardBehaviour === CardBehaviour.HARD_DECLINE && !c.isPaused).length;
    const autoCoverCount = configs.filter(c => c.cardBehaviour === CardBehaviour.AUTO_COVER && !c.isPaused).length;
    const bufferCount = configs.filter(c => c.cardBehaviour === CardBehaviour.BUFFER && !c.isPaused).length;
    const flexibleCount = configs.filter(c => c.governanceMode === GovernanceMode.FLEXIBLE && !c.isPaused).length;
    const strictCount = configs.filter(c => c.governanceMode === GovernanceMode.STRICT && !c.isPaused).length;

    const defaultModeConfigs = {
      Flexible: {
        status: 'ACTIVE',
        allowedBehaviours: ['Hard Decline', 'Auto Cover', 'Buffer'],
        description: 'Flexible allocation with auto-cover and optional buffer protection'
      },
      Strict: {
        status: 'ACTIVE',
        allowedBehaviours: ['Hard Decline', 'Auto Cover'],
        description: 'Strict balance & daily safe-spend enforcement'
      }
    };

    let controls = await this.safiControlRepository.findOne({ where: {} });
    if (!controls) {
      controls = await this.safiControlRepository.save({
        governanceMode: 'Flexible',
        allowedBehaviours: ['Hard Decline', 'Auto Cover', 'Buffer'],
        activeModes: ['Flexible', 'Strict'],
        modeConfigurations: defaultModeConfigs
      });
    }

    const rawModeConfigs = { ...defaultModeConfigs, ...(controls.modeConfigurations || {}) };
    // Normalize allowedBehaviours to always be a proper array
    for (const modeName of Object.keys(rawModeConfigs)) {
      const modeCfg = rawModeConfigs[modeName] as any;
      if (modeCfg && typeof modeCfg.allowedBehaviours === 'string') {
        modeCfg.allowedBehaviours = (modeCfg.allowedBehaviours as string).split(',').map((s: string) => s.trim()).filter(Boolean);
      } else if (modeCfg && !Array.isArray(modeCfg.allowedBehaviours)) {
        modeCfg.allowedBehaviours = [];
      }
    }
    const modeConfigs = rawModeConfigs;

    return {
      metrics: {
        activeAccounts: activeAccountsCount > 0 ? activeAccountsCount : 12847,
        governedFunds: governedFundsVal,
        depositRetention,
        overrideRate,
        complianceIndex
      },
      controls: {
        governanceMode: controls.governanceMode,
        allowedBehaviours: controls.allowedBehaviours,
        activeModes: controls.activeModes,
        modeConfigurations: modeConfigs
      },
      integrationStatus: {
        coreBanking: 'CONNECTED',
        decisionLayer: 'ACTIVE',
        allocationEngine: 'ACTIVE',
        behaviouralAnalytics: 'SYNCING'
      },
      subModeCounts: {
        hardDecline: hardDeclineCount,
        autoCover: autoCoverCount,
        buffer: bufferCount
      },
      modeCounts: {
        flexible: flexibleCount,
        strict: strictCount
      }
    };
  }

  async getControls(): Promise<any> {
    const defaultModeConfigs = {
      Flexible: {
        status: 'ACTIVE',
        allowedBehaviours: ['Hard Decline', 'Auto Cover', 'Buffer'],
        description: 'Flexible allocation with auto-cover and optional buffer protection'
      },
      Strict: {
        status: 'ACTIVE',
        allowedBehaviours: ['Hard Decline', 'Auto Cover'],
        description: 'Strict balance & daily safe-spend enforcement'
      }
    };

    let controls = await this.safiControlRepository.findOne({ where: {} });
    if (!controls) {
      controls = await this.safiControlRepository.save({
        governanceMode: 'Flexible',
        allowedBehaviours: ['Hard Decline', 'Auto Cover', 'Buffer'],
        activeModes: ['Flexible', 'Strict'],
        modeConfigurations: defaultModeConfigs
      });
    }
    // Always merge defaults to ensure both modes are present and allowedBehaviours is an array
    const mergedConfigs = { ...defaultModeConfigs, ...(controls.modeConfigurations || {}) };
    for (const modeName of Object.keys(mergedConfigs)) {
      const modeCfg = mergedConfigs[modeName] as any;
      if (modeCfg && typeof modeCfg.allowedBehaviours === 'string') {
        modeCfg.allowedBehaviours = (modeCfg.allowedBehaviours as string).split(',').map((s: string) => s.trim()).filter(Boolean);
      } else if (modeCfg && !Array.isArray(modeCfg.allowedBehaviours)) {
        modeCfg.allowedBehaviours = [];
      }
    }
    controls.modeConfigurations = mergedConfigs;
    return controls;
  }


  async getAdminRules(): Promise<any[]> {
    const rules = await this.safiRuleRepository.find();

    // Compute dynamic account counts from database
    const activeCount = await this.safiConfigRepository.count({ where: { isPaused: false } });
    const hardDeclineCount = await this.safiConfigRepository.count({
      where: { cardBehaviour: CardBehaviour.HARD_DECLINE, isPaused: false }
    });
    const monthlyCount = await this.safiConfigRepository.count({
      where: { frequency: ConfigFrequency.MONTHLY, isPaused: false }
    });
    const strictCount = await this.safiConfigRepository.count({
      where: { governanceMode: GovernanceMode.STRICT, isPaused: false }
    });

    return rules
      .filter(rule => rule.name !== 'Salary-Linked Allocation Trigger')
      .map(rule => {
        let dynamicAccounts = rule.accounts;
        if (rule.name.includes('Standard Allocation')) {
          dynamicAccounts = activeCount;
        } else if (rule.name.includes('Hard Decline')) {
          dynamicAccounts = hardDeclineCount;
        } else if (rule.name.includes('Salary-Linked')) {
          dynamicAccounts = monthlyCount;
        } else if (rule.name.includes('High-Volume') || rule.name.includes('strict')) {
          dynamicAccounts = strictCount;
        }
        return {
          ...rule,
          accounts: dynamicAccounts
        };
      });
  }

  async createAdminRule(ruleDto: any): Promise<any> {
    const newRule = await this.safiRuleRepository.save({
      name: ruleDto.name,
      description: ruleDto.description,
      status: ruleDto.status || 'ACTIVE',
      accounts: ruleDto.accounts || Math.floor(Math.random() * 500) + 50
    });

    await this.safiAuditLogRepository.save({
      actor: 'Admin (aboajah)',
      action: `Created new governance rule "${newRule.name}" with status ${newRule.status}.`
    });

    return newRule;
  }

  async updateAdminRule(id: string, status: string): Promise<any> {
    const rule = await this.safiRuleRepository.findOne({ where: { id } });
    if (!rule) {
      throw new NotFoundException(`Rule with ID ${id} not found.`);
    }
    rule.status = status;
    await this.safiRuleRepository.save(rule);

    await this.safiAuditLogRepository.save({
      actor: 'Admin (aboajah)',
      action: `Updated rule "${rule.name}" status to ${status}.`
    });

    return rule;
  }

  async deleteAdminRule(id: string): Promise<any> {
    const rule = await this.safiRuleRepository.findOne({ where: { id } });
    if (!rule) {
      throw new NotFoundException(`Rule with ID ${id} not found.`);
    }
    await this.safiRuleRepository.remove(rule);

    await this.safiAuditLogRepository.save({
      actor: 'Admin (aboajah)',
      action: `Deleted rule "${rule.name}" from active governance cycle.`
    });

    return { success: true };
  }

  async getAdminAuditLogs(): Promise<any[]> {
    const logs = await this.safiAuditLogRepository.find({
      order: { createdAt: 'DESC' }
    });

    return logs.map(log => {
      const diffMs = Date.now() - new Date(log.createdAt).getTime();
      const diffMins = Math.floor(diffMs / 60000);
      let timestamp = 'Just now';
      if (diffMins > 0) {
        if (diffMins < 60) {
          timestamp = `${diffMins} mins ago`;
        } else {
          const diffHours = Math.floor(diffMins / 60);
          if (diffHours < 24) {
            timestamp = `${diffHours} hours ago`;
          } else {
            timestamp = `${Math.floor(diffHours / 24)} days ago`;
          }
        }
      }
      return {
        id: log.id,
        actor: log.actor,
        action: log.action,
        timestamp
      };
    });
  }

  async updateAdminControls(controlsDto: any): Promise<any> {
    let controls = await this.safiControlRepository.findOne({ where: {} });
    if (!controls) {
      controls = new SafiControl();
      controls.modeConfigurations = {
        Flexible: {
          status: 'ACTIVE',
          allowedBehaviours: ['Hard Decline', 'Auto Cover', 'Buffer'],
          description: 'Flexible allocation with auto-cover and optional buffer protection'
        },
        Strict: {
          status: 'ACTIVE',
          allowedBehaviours: ['Hard Decline', 'Auto Cover'],
          description: 'Strict balance & daily safe-spend enforcement'
        }
      };
    }
    
    if (controlsDto.governanceMode !== undefined) {
      controls.governanceMode = controlsDto.governanceMode;
    }
    if (controlsDto.allowedBehaviours !== undefined) {
      controls.allowedBehaviours = controlsDto.allowedBehaviours;
    }
    if (controlsDto.activeModes !== undefined) {
      controls.activeModes = controlsDto.activeModes;
    }
    if (controlsDto.modeConfigurations !== undefined) {
      // Always start with both-mode defaults to prevent either mode from being lost on partial updates
      const bothModeDefaults = {
        Flexible: {
          status: 'ACTIVE',
          allowedBehaviours: ['Hard Decline', 'Auto Cover', 'Buffer'],
          description: 'Flexible allocation with auto-cover and optional buffer protection'
        },
        Strict: {
          status: 'ACTIVE',
          allowedBehaviours: ['Hard Decline', 'Auto Cover'],
          description: 'Strict balance & daily safe-spend enforcement'
        }
      };
      controls.modeConfigurations = {
        ...bothModeDefaults,
        ...(controls.modeConfigurations || {}),
        ...controlsDto.modeConfigurations
      };

      // Normalize allowedBehaviours inside each mode config to always be a proper array
      for (const modeName of Object.keys(controls.modeConfigurations)) {
        const modeCfg = controls.modeConfigurations[modeName] as any;
        if (modeCfg && typeof modeCfg.allowedBehaviours === 'string') {
          modeCfg.allowedBehaviours = (modeCfg.allowedBehaviours as string)
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean);
        } else if (modeCfg && !Array.isArray(modeCfg.allowedBehaviours)) {
          modeCfg.allowedBehaviours = [];
        }
      }
      
      const activeModes: string[] = [];
      Object.entries(controls.modeConfigurations).forEach(([modeName, modeCfg]: [string, any]) => {
        if (modeCfg && modeCfg.status === 'ACTIVE') {
          activeModes.push(modeName);
        }
      });
      // Always update activeModes to reflect the actual mode statuses
      controls.activeModes = activeModes.length > 0 ? activeModes : ['Flexible'];
    }

    await this.safiControlRepository.save(controls);

    await this.safiAuditLogRepository.save({
      actor: 'Admin (aboajah)',
      action: `Updated mode configurations & governance controls: ${Object.keys(controlsDto).join(', ')}.`
    });

    return controls;
  }

  async getAdminTransactions(): Promise<any[]> {
    const safiTxs = await this.safiTransactionRepository.find({
      order: { createdAt: 'DESC' },
      take: 20
    });

    const list: any[] = [];
    for (const st of safiTxs) {
      const stAmount = st.amount;
      const stAccount = st.accountNumber;
      
      const override = await this.safiOverrideRepository.findOne({
        where: {
          accountNumber: stAccount,
          amount: stAmount,
        },
        order: { createdAt: 'DESC' }
      });

      let outcome = 'APPROVED';
      if (override) {
        if (override.type === OverrideType.AUTO_COVER) {
          outcome = 'REDIRECTED';
        } else if (override.type === OverrideType.LIMIT_BREACH) {
          outcome = 'ESCALATED';
        } else {
          outcome = 'ESCALATED';
        }
      }

      let action = 'POS - Retail';
      try {
        const coreTx = await this.safiTransactionRepository.manager.getRepository(Transaction).findOne({
          where: { reference: st.reference }
        });
        if (coreTx && coreTx.description) {
          action = coreTx.description;
        }
      } catch (err) {
        // Ignore
      }

      list.push({
        id: st.id,
        account: '****' + stAccount.slice(-4),
        action,
        amount: Number(stAmount) / 100, // convert kobo to Naira
        outcome,
        createdAt: st.createdAt
      });
    }

    if (list.length === 0) {
      return [
        { id: 'tx-1', account: '****4821', action: 'Transfer - GTBank', amount: 40000, outcome: 'ESCALATED' },
        { id: 'tx-2', account: '****2210', action: 'POS - Shoprite', amount: 8500, outcome: 'APPROVED' },
        { id: 'tx-3', account: '****9834', action: 'ATM Withdrawal', amount: 20000, outcome: 'REDIRECTED' },
        { id: 'tx-4', account: '****7781', action: 'Transfer - Zenith', amount: 55000, outcome: 'DECLINED' }
      ];
    }

    return list;
  }

  async getAdminDeployments(): Promise<any> {
    const settings = await this.readSettings();
    return {
      clusters: settings.deployments.clusters
    };
  }

  async getAdminAnalytics(): Promise<any> {
    const cycles = await this.safiCycleRepository.find();
    const configs = await this.safiConfigRepository.find();

    // 1. Calculate actual protected deposits from safi_configs in DB
    let totalProtectedKobo = 0n;
    configs.forEach(c => {
      if (!c.isPaused) {
        totalProtectedKobo += BigInt(c.protectedSum || 0);
      }
    });

    const protectedNairaTotal = Number(totalProtectedKobo) / 100;

    // 2. Compute Matrix Breakdown directly from safi_configs
    const strictCount = configs.filter(c => (c.governanceMode || '').toLowerCase() === 'strict').length;
    const flexibleCount = configs.filter(c => (c.governanceMode || '').toLowerCase() === 'flexible').length;
    const pausedCount = configs.filter(c => c.isPaused).length;
    const totalConfigs = configs.length || 1;

    const matrixBreakdown = {
      strict: {
        count: strictCount,
        percentage: Math.round((strictCount / totalConfigs) * 100)
      },
      flexible: {
        count: flexibleCount,
        percentage: Math.round((flexibleCount / totalConfigs) * 100)
      },
      paused: {
        count: pausedCount,
        percentage: Math.round((pausedCount / totalConfigs) * 100)
      }
    };

    // 3. Compute Rule Triggers percentages directly from safi_configs
    let ruleTriggers = { standardAllocation: 0, hardDecline: 0, salaryLinked: 0 };
    if (configs.length > 0) {
      const hardDeclineCount = configs.filter(c => (c.cardBehaviour as any) === CardBehaviour.HARD_DECLINE || (c.cardBehaviour as any) === 'hard_decline' || (c.cardBehaviour as any) === 'Hard Decline').length;
      const autoCoverCount = configs.filter(c => (c.cardBehaviour as any) === CardBehaviour.AUTO_COVER || (c.cardBehaviour as any) === 'auto_cover' || (c.cardBehaviour as any) === 'Auto Cover').length;
      const bufferCount = configs.filter(c => (c.cardBehaviour as any) === CardBehaviour.BUFFER || (c.cardBehaviour as any) === 'buffer' || String(c.cardBehaviour || '').toLowerCase().startsWith('buffer')).length;
      
      const hardDeclinePct = Math.round((hardDeclineCount / configs.length) * 100);
      const autoCoverPct = Math.round((autoCoverCount / configs.length) * 100);
      const bufferPct = Math.max(0, 100 - hardDeclinePct - autoCoverPct);

      ruleTriggers = {
        standardAllocation: autoCoverPct,
        hardDecline: hardDeclinePct,
        salaryLinked: bufferPct
      };
    }

    // 4. Compute Governed Funds Trend strictly for PAST months up to current month (e.g. Mar 2026 - Aug 2026)
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const now = new Date();
    const currentMonthIdx = now.getMonth();
    const currentYear = now.getFullYear();

    // Generate past 6 months ending at current month (e.g. Mar 2026 to Aug 2026)
    const pastMonths: { label: string, monthIdx: number, year: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(currentYear, currentMonthIdx - i, 1);
      pastMonths.push({
        label: `${monthNames[d.getMonth()]} ${d.getFullYear()}`,
        monthIdx: d.getMonth(),
        year: d.getFullYear()
      });
    }

    // Aggregate DB cycles by month & year
    const monthlyMap = new Map<string, { totalProtectedKobo: bigint, accounts: Set<string>, breachedCount: number, totalCycles: number }>();
    for (const c of cycles) {
      const date = new Date(c.endDate || c.createdAt);
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      if (!monthlyMap.has(key)) {
        monthlyMap.set(key, { totalProtectedKobo: 0n, accounts: new Set<string>(), breachedCount: 0, totalCycles: 0 });
      }
      const entry = monthlyMap.get(key)!;
      entry.totalProtectedKobo += BigInt(c.protectedSum || c.income || 0);
      entry.accounts.add(c.accountNumber);
      entry.totalCycles += 1;
      if (c.outcome === CycleOutcome.OVER_BUDGET || (c.outcome as any) === 'BREACHED') {
        entry.breachedCount += 1;
      }
    }

    const trendData = pastMonths.map((mObj, idx) => {
      const key = `${mObj.year}-${mObj.monthIdx}`;
      const stats = monthlyMap.get(key);

      if (stats && stats.accounts.size > 0) {
        const amountNaira = Number(stats.totalProtectedKobo) / 100;
        const breachRate = stats.totalCycles > 0 ? (stats.breachedCount / stats.totalCycles) * 100 : 0;
        return {
          month: mObj.label,
          val: amountNaira > 0 ? amountNaira : protectedNairaTotal,
          accounts: stats.accounts.size,
          retentionRate: Math.max(0, Math.round(100 - breachRate)),
          retentionDays: 28.4
        };
      }

      // Past month scaling up to current DB total for accounts created prior
      const ratio = 0.5 + (idx / 5) * 0.5; // Smooth progression over past 6 months up to 100% current DB state
      const historicalVal = Math.round(protectedNairaTotal * ratio);
      const historicalAccounts = Math.max(1, Math.round((configs.length || 16) * ratio));

      return {
        month: mObj.label,
        val: historicalVal,
        accounts: historicalAccounts,
        retentionRate: Math.min(100, Math.round(75 + idx * 4.5)),
        retentionDays: parseFloat((24.0 + idx * 0.88).toFixed(1))
      };
    });

    // 5. Deposit Retention Curve stats computed directly from DB
    let protectedTotalStr = `₦${protectedNairaTotal.toLocaleString()}`;
    if (protectedNairaTotal >= 1_000_000_000) {
      protectedTotalStr = `₦${(protectedNairaTotal / 1_000_000_000).toFixed(2)}B`;
    } else if (protectedNairaTotal >= 1_000_000) {
      protectedTotalStr = `₦${(protectedNairaTotal / 1_000_000).toFixed(2)}M`;
    }

    let averageDaysStr = '0.0 Days';
    if (cycles.length > 0) {
      let totalDays = 0;
      cycles.forEach(c => {
        const diffTime = Math.abs(new Date(c.endDate).getTime() - new Date(c.startDate).getTime());
        const diffDays = diffTime / (1000 * 60 * 60 * 24);
        totalDays += diffDays;
      });
      averageDaysStr = `${(totalDays / cycles.length).toFixed(1)} Days`;
    }

    let breachLeakageStr = '0.00%';
    if (cycles.length > 0) {
      const breached = cycles.filter(c => c.outcome === CycleOutcome.OVER_BUDGET || (c.outcome as any) === 'BREACHED').length;
      breachLeakageStr = `${((breached / cycles.length) * 100).toFixed(2)}%`;
    }

    const depositRetentionCurve = {
      protectedTotal: protectedTotalStr,
      averageDays: averageDaysStr,
      breachLeakage: breachLeakageStr,
      protectedNairaTotal,
      activeAccountsCount: configs.length
    };

    return {
      trendData,
      ruleTriggers,
      depositRetentionCurve,
      matrixBreakdown
    };
  }

  async getAdminCompliance(): Promise<any> {
    const settings = await this.readSettings();
    const defaultCompliance = settings.compliance || {};

    const monthNamesLong = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const cycles = await this.safiCycleRepository.find();
    
    // Group cycles by "Month Year" dynamically
    const complianceGroups: Record<string, {
      scores: number[];
      accounts: Set<string>;
      overrides: number;
      date: Date;
    }> = {};

    for (const c of cycles) {
      const date = new Date(c.endDate);
      const periodKey = `${monthNamesLong[date.getMonth()]} ${date.getFullYear()}`;
      if (!complianceGroups[periodKey]) {
        complianceGroups[periodKey] = {
          scores: [],
          accounts: new Set<string>(),
          overrides: 0,
          date
        };
      }
      complianceGroups[periodKey].scores.push(c.complianceScore);
      complianceGroups[periodKey].accounts.add(c.accountNumber);
      complianceGroups[periodKey].overrides += c.overrideCount || 0;
    }

    const reports = Object.keys(complianceGroups)
      .map(period => {
        const group = complianceGroups[period];
        const avgScore = group.scores.length > 0
          ? parseFloat((group.scores.reduce((sum, s) => sum + s, 0) / group.scores.length).toFixed(1))
          : 0;
        return {
          period,
          index: avgScore,
          accounts: group.accounts.size,
          overrides: group.overrides,
          status: 'Completed',
          dateVal: group.date
        };
      })
      .sort((a, b) => b.dateVal.getTime() - a.dateVal.getTime());

    const complianceReports = reports.length > 0 ? reports : (defaultCompliance.reports || []);

    return {
      reports: complianceReports,
      checkpoints: defaultCompliance.checkpoints,
      webhookUrl: defaultCompliance.webhookUrl,
      webhookFreq: defaultCompliance.webhookFreq
    };
  }

  async updateAdminComplianceWebhook(body: any): Promise<any> {
    const settings = await this.readSettings();
    settings.compliance.webhookUrl = body.webhookUrl;
    settings.compliance.webhookFreq = body.webhookFreq;
    await this.writeSettings(settings);
    return settings.compliance;
  }
}
