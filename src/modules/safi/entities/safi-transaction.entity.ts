import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';

export enum SafiTransactionType {
  CREDIT = 'credit',
  DEBIT = 'debit',
}

@Entity('safi_transactions')
export class SafiTransaction extends BaseEntity {
  @Index()
  @Column({ type: 'varchar', length: 11 })
  accountNumber: string;

  @Column({ type: 'enum', enum: SafiTransactionType })
  type: SafiTransactionType;

  @Column({ type: 'bigint' })
  amount: string;

  @Column({ type: 'bigint' })
  balanceAfter: string;

  @Column({ unique: true })
  reference: string;
}
