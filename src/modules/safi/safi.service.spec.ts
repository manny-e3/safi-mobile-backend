import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { SafiService } from './safi.service';
import { SafiConfig, CardBehaviour, RolloverPreference, GovernanceMode, ConfigFrequency } from './entities/safi-config.entity';
import { SafiCycle, CycleOutcome } from './entities/safi-cycle.entity';
import { SafiTransaction, SafiTransactionType } from './entities/safi-transaction.entity';
import { SafiOverride, OverrideType } from './entities/safi-override.entity';
import { WalletService } from '../core-banking/wallet/wallet.service';

describe('SafiService', () => {
  let service: SafiService;
  let configRepo: any;
  let cycleRepo: any;
  let txRepo: any;
  let overrideRepo: any;
  let walletService: any;

  const mockConfig: SafiConfig = {
    id: 'config-uuid',
    accountNumber: '12345678901',
    income: '500000',
    protectedSum: '200000',
    baselineBalance: '500000',
    governanceMode: GovernanceMode.FLEXIBLE,
    frequency: ConfigFrequency.MONTHLY,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    cardBehaviour: CardBehaviour.HARD_DECLINE,
    bufferAmount: '0',
    remainingBuffer: '0',
    rolloverPreference: RolloverPreference.RETURN_TO_RESERVE,
    isPaused: false,
    pauseCountThisYear: 0,
    pauseStartedAt: null,
    overrideActive: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  } as any;

  beforeEach(async () => {
    configRepo = {
      findOne: jest.fn().mockResolvedValue(mockConfig),
      save: jest.fn().mockImplementation((config) => Promise.resolve(config)),
      create: jest.fn().mockImplementation((dto) => dto),
      query: jest.fn().mockResolvedValue([{ now: new Date() }]),
    };
    cycleRepo = {
      save: jest.fn(),
      create: jest.fn().mockImplementation((dto) => dto),
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
    };
    txRepo = {
      save: jest.fn(),
      create: jest.fn().mockImplementation((dto) => dto),
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
    };
    overrideRepo = {
      save: jest.fn(),
      create: jest.fn().mockImplementation((dto) => dto),
      find: jest.fn().mockResolvedValue([]),
    };
    walletService = {
      findByAccountNumber: jest.fn().mockResolvedValue({ balance: '500000' }),
      getTransactionsByAccountNumber: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SafiService,
        { provide: getRepositoryToken(SafiConfig), useValue: configRepo },
        { provide: getRepositoryToken(SafiCycle), useValue: cycleRepo },
        { provide: getRepositoryToken(SafiTransaction), useValue: txRepo },
        { provide: getRepositoryToken(SafiOverride), useValue: overrideRepo },
        { provide: WalletService, useValue: walletService },
      ],
    }).compile();

    service = module.get<SafiService>(SafiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('assertWithdrawalAllowed', () => {
    it('should bypass checks if config is paused', async () => {
      configRepo.findOne.mockResolvedValueOnce({ ...mockConfig, isPaused: true });
      // Should not throw even if prospective balance falls below reserve in strict mode
      await expect(
        service.assertWithdrawalAllowed('12345678901', 50000n),
      ).resolves.not.toThrow();
    });

    it('should throw BadRequestException if cardBehaviour is HARD_DECLINE and balance drops below Reserve', async () => {
      configRepo.findOne.mockResolvedValueOnce({
        ...mockConfig,
        cardBehaviour: CardBehaviour.HARD_DECLINE,
      });
      // Prospective balance 150,000 is below protectedSum 200,000
      await expect(
        service.assertWithdrawalAllowed('12345678901', 150000n),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if cardBehaviour is BUFFER and excess exceeds remaining buffer', async () => {
      configRepo.findOne.mockResolvedValueOnce({
        ...mockConfig,
        cardBehaviour: CardBehaviour.BUFFER,
        bufferAmount: '10000',
        remainingBuffer: '10000',
      });
      // Prospective balance 180,000 (breach is 20,000, which exceeds buffer of 10,000)
      await expect(
        service.assertWithdrawalAllowed('12345678901', 180000n),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow transaction if cardBehaviour is BUFFER and excess is within remaining buffer', async () => {
      configRepo.findOne.mockResolvedValueOnce({
        ...mockConfig,
        cardBehaviour: CardBehaviour.BUFFER,
        bufferAmount: '50000',
        remainingBuffer: '50000',
      });
      // Prospective balance 180,000 (breach is 20,000, which is within buffer of 50,000)
      await expect(
        service.assertWithdrawalAllowed('12345678901', 180000n),
      ).resolves.not.toThrow();
    });

    it('should allow transaction if cardBehaviour is AUTO_COVER', async () => {
      configRepo.findOne.mockResolvedValueOnce({
        ...mockConfig,
        cardBehaviour: CardBehaviour.AUTO_COVER,
      });
      await expect(
        service.assertWithdrawalAllowed('12345678901', 150000n),
      ).resolves.not.toThrow();
    });
  });

  describe('pause and resume', () => {
    it('should successfully pause safi config if limit not exceeded', async () => {
      const result = await service.pause('12345678901');
      expect(result.isPaused).toBe(true);
      expect(result.pauseCountThisYear).toBe(1);
      expect(result.pauseStartedAt).toBeInstanceOf(Date);
    });

    it('should throw if pause limit of 3 is reached', async () => {
      configRepo.findOne.mockResolvedValueOnce({
        ...mockConfig,
        pauseCountThisYear: 3,
      });
      await expect(service.pause('12345678901')).rejects.toThrow(BadRequestException);
    });

    it('should successfully resume safi config', async () => {
      configRepo.findOne.mockResolvedValueOnce({
        ...mockConfig,
        isPaused: true,
        pauseStartedAt: new Date(),
      });
      const result = await service.resume('12345678901');
      expect(result.isPaused).toBe(false);
      expect(result.pauseStartedAt).toBeNull();
    });
  });

  describe('projections', () => {
    it('should calculate projection over 3, 6, and 12 months with default savings', async () => {
      const result = await service.getProjection('12345678901');
      // Spend Pool allocation = 500,000 - 200,000 = 300,000
      // Default avgSavingsPerCycle = 10% = 30,000
      // Monthly savings = 30,000
      // 3 Months = 200,000 + 30,000 * 3 = 290,000
      // 6 Months = 200,000 + 30,000 * 6 = 380,000
      // 12 Months = 200,000 + 30,000 * 12 = 560,000
      expect(result.month3).toBe('290000');
      expect(result.month6).toBe('380000');
      expect(result.month12).toBe('560000');
    });
  });
});
