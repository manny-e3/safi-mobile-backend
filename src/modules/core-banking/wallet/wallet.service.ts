import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, EntityManager, MoreThanOrEqual, Repository } from 'typeorm';
import { SafiTransactionType } from '../../safi/entities/safi-transaction.entity';
import { SafiService } from '../../safi/safi.service';
import { Transaction, TransactionType } from './entities/transaction.entity';
import { TransferWalletDto } from './dto/transfer-wallet.dto';
import { Wallet } from './entities/wallet.entity';

const ACCOUNT_NUMBER_LENGTH = 11;

@Injectable()
export class WalletService {
  constructor(
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    private readonly dataSource: DataSource,
    @Inject(forwardRef(() => SafiService))
    private readonly safiService: SafiService,
  ) {}

  async createForUser(
    userId: string,
    manager?: EntityManager,
  ): Promise<Wallet> {
    const repository = manager
      ? manager.getRepository(Wallet)
      : this.walletRepository;

    const accountNumber = await this.generateUniqueAccountNumber(repository);

    return repository.save(
      repository.create({ userId, accountNumber, balance: '0' }),
    );
  }

  findByUserId(userId: string): Promise<Wallet | null> {
    return this.walletRepository.findOne({
      where: { userId },
      relations: {
        user: true,
      },
    });
  }

  findByAccountNumber(accountNumber: string): Promise<Wallet | null> {
    return this.walletRepository.findOne({ where: { accountNumber } });
  }

  async getTransactions(userId: string): Promise<Transaction[]> {
    const wallet = await this.findByUserId(userId);
    if (!wallet) throw new NotFoundException('Wallet not found');

    return this.transactionRepository.find({
      where: { walletId: wallet.id },
      order: { createdAt: 'DESC' },
    });
  }

  async getTransactionsByAccountNumber(
    accountNumber: string,
    start?: Date,
    end?: Date,
  ): Promise<Transaction[]> {
    const wallet = await this.findByAccountNumber(accountNumber);
    if (!wallet) throw new NotFoundException('Wallet not found');

    const where: any = { walletId: wallet.id };
    if (start) {
      if (end) {
        where.createdAt = Between(start, end);
      } else {
        where.createdAt = MoreThanOrEqual(start);
      }
    }

    return this.transactionRepository.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  fund(
    userId: string,
    amount: bigint,
    description?: string,
  ): Promise<{ wallet: Wallet; transaction: Transaction }> {
    return this.applyEntry(userId, amount, TransactionType.CREDIT, description);
  }

  withdraw(
    userId: string,
    amount: bigint,
    description?: string,
  ): Promise<{ wallet: Wallet; transaction: Transaction }> {
    return this.applyEntry(userId, amount, TransactionType.DEBIT, description);
  }

  private async applyEntry(
    userId: string,
    amount: bigint,
    type: TransactionType,
    description?: string,
  ): Promise<{ wallet: Wallet; transaction: Transaction }> {
    if (amount <= 0n) {
      throw new BadRequestException('Amount must be greater than zero');
    }

    return this.dataSource.transaction(async (manager) => {
      const walletRepository = manager.getRepository(Wallet);
      const wallet = await walletRepository.findOne({
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!wallet) throw new NotFoundException('Wallet not found');

      const balanceBefore = BigInt(wallet.balance);
      const balanceAfter =
        type === TransactionType.CREDIT
          ? balanceBefore + amount
          : balanceBefore - amount;

      if (balanceAfter < 0n) {
        throw new BadRequestException('Insufficient balance');
      }

      if (type === TransactionType.DEBIT) {
        await this.safiService.assertWithdrawalAllowed(
          wallet.accountNumber,
          balanceAfter,
        );
      }

      wallet.balance = balanceAfter.toString();
      await walletRepository.save(wallet);

      const transactionRepository = manager.getRepository(Transaction);
      const transaction = await transactionRepository.save(
        transactionRepository.create({
          walletId: wallet.id,
          type,
          amount: amount.toString(),
          balanceBefore: balanceBefore.toString(),
          balanceAfter: balanceAfter.toString(),
          reference: crypto.randomUUID(),
          description: description ?? null,
        }),
      );

      await this.safiService.recordTransaction(
        wallet.accountNumber,
        {
          type:
            type === TransactionType.CREDIT
              ? SafiTransactionType.CREDIT
              : SafiTransactionType.DEBIT,
          amount: amount.toString(),
          balanceAfter: balanceAfter.toString(),
          reference: transaction.reference,
        },
        manager,
      );

      return { wallet, transaction };
    });
  }

  private async generateUniqueAccountNumber(
    repository: Repository<Wallet>,
  ): Promise<string> {
    let accountNumber: string;
    let existing: Wallet | null;

    do {
      accountNumber = this.generateAccountNumber();
      existing = await repository.findOne({ where: { accountNumber } });
    } while (existing);

    return accountNumber;
  }

  private generateAccountNumber(): string {
    let accountNumber = String(Math.floor(Math.random() * 9) + 1);
    for (let i = 1; i < ACCOUNT_NUMBER_LENGTH; i++) {
      accountNumber += Math.floor(Math.random() * 10);
    }
    return accountNumber;
  }

  async transfer(
    userId: string,
    dto: TransferWalletDto,
  ): Promise<{ wallet: Wallet; transaction: Transaction }> {
    const amount = BigInt(dto.amount);
    if (amount <= 0n) {
      throw new BadRequestException('Amount must be greater than zero');
    }

    return this.dataSource.transaction(async (manager) => {
      const walletRepository = manager.getRepository(Wallet);
      const senderWallet = await walletRepository.findOne({
        where: { userId },
        relations: { user: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (!senderWallet) throw new NotFoundException('Sender wallet not found');

      const balanceBefore = BigInt(senderWallet.balance);
      const balanceAfter = balanceBefore - amount;

      if (balanceAfter < 0n) {
        throw new BadRequestException('Insufficient balance to complete transfer');
      }

      // Assert SAFI protection rules
      await this.safiService.assertWithdrawalAllowed(
        senderWallet.accountNumber,
        balanceAfter,
      );

      // Check if recipient is internal Meridian account
      const recipientWallet = await walletRepository.findOne({
        where: { accountNumber: dto.recipientAccountNumber },
        relations: { user: true },
      });

      // Update sender balance
      senderWallet.balance = balanceAfter.toString();
      await walletRepository.save(senderWallet);

      const transactionRepository = manager.getRepository(Transaction);

      const recipientDesc = dto.recipientName
        ? `${dto.recipientName} (${dto.recipientBank || 'Meridian Bank'})`
        : `Account ${dto.recipientAccountNumber}`;
      const memo = dto.narration ? ` - ${dto.narration}` : '';

      // Create debit transaction for sender
      const senderTx = await transactionRepository.save(
        transactionRepository.create({
          walletId: senderWallet.id,
          type: TransactionType.DEBIT,
          amount: amount.toString(),
          balanceBefore: balanceBefore.toString(),
          balanceAfter: balanceAfter.toString(),
          reference: crypto.randomUUID(),
          description: `Transfer to ${recipientDesc}${memo}`,
        }),
      );

      // If internal recipient, credit their wallet and record transaction
      if (recipientWallet && recipientWallet.id !== senderWallet.id) {
        const recBalBefore = BigInt(recipientWallet.balance);
        const recBalAfter = recBalBefore + amount;
        recipientWallet.balance = recBalAfter.toString();
        await walletRepository.save(recipientWallet);

        await transactionRepository.save(
          transactionRepository.create({
            walletId: recipientWallet.id,
            type: TransactionType.CREDIT,
            amount: amount.toString(),
            balanceBefore: recBalBefore.toString(),
            balanceAfter: recBalAfter.toString(),
            reference: crypto.randomUUID(),
            description: `Transfer from ${senderWallet.user?.name || senderWallet.accountNumber}${memo}`,
          }),
        );
      }

      // Record in SAFI
      await this.safiService.recordTransaction(
        senderWallet.accountNumber,
        {
          type: SafiTransactionType.DEBIT,
          amount: amount.toString(),
          balanceAfter: balanceAfter.toString(),
          reference: senderTx.reference,
        },
        manager,
      );

      return { wallet: senderWallet, transaction: senderTx };
    });
  }

  async resolveAccount(accountNumber: string): Promise<{
    accountNumber: string;
    accountName: string | null;
    bank: string;
    isInternal: boolean;
  }> {
    const wallet = await this.walletRepository.findOne({
      where: { accountNumber },
      relations: { user: true },
    });

    if (wallet) {
      return {
        accountNumber,
        accountName: wallet.user?.name || 'Meridian Account Holder',
        bank: 'Meridian Bank',
        isInternal: true,
      };
    }

    return {
      accountNumber,
      accountName: null,
      bank: 'External Institution',
      isInternal: false,
    };
  }
}
