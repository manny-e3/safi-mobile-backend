import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/entities/base.entity';
import { Wallet } from './wallet.entity';

export enum TransactionType {
  CREDIT = 'credit',
  DEBIT = 'debit',
}

export enum TransactionStatus {
  SUCCESSFUL = 'successful',
  FAILED = 'failed',
}

@Entity('core_banking_transactions')
export class Transaction extends BaseEntity {
  @Column()
  walletId: string;

  @ManyToOne(() => Wallet, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'walletId' })
  wallet: Wallet;

  @Column({ type: 'enum', enum: TransactionType })
  type: TransactionType;

  @Column({ type: 'bigint' })
  amount: string;

  @Column({ type: 'bigint' })
  balanceBefore: string;

  @Column({ type: 'bigint' })
  balanceAfter: string;

  @Column({
    type: 'enum',
    enum: TransactionStatus,
    default: TransactionStatus.SUCCESSFUL,
  })
  status: TransactionStatus;

  @Column({ unique: true })
  reference: string;

  @Column({ type: 'varchar', nullable: true })
  description: string | null;
}
