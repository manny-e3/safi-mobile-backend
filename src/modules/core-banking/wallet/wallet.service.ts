import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Transaction, TransactionType } from './entities/transaction.entity';
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
    return this.walletRepository.findOne({ where: { userId } });
  }

  async getTransactions(userId: string): Promise<Transaction[]> {
    const wallet = await this.findByUserId(userId);
    if (!wallet) throw new NotFoundException('Wallet not found');

    return this.transactionRepository.find({
      where: { walletId: wallet.id },
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
}
