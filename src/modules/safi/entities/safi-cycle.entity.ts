import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';

export enum CycleOutcome {
  RETURNED = 'returned',
  OVER_BUDGET = 'over_budget',
  EXACT = 'exact',
}

@Entity('safi_cycles')
export class SafiCycle extends BaseEntity {
  @Index()
  @Column({ type: 'varchar', length: 11 })
  accountNumber: string;

  @Column({ type: 'timestamp' })
  startDate: Date;

  @Column({ type: 'timestamp' })
  endDate: Date;

  @Column({ type: 'bigint' })
  income: string;

  @Column({ type: 'bigint' })
  protectedSum: string;

  @Column({ type: 'bigint' })
  allocation: string;

  @Column({ type: 'bigint' })
  netAmount: string;

  @Column({ type: 'int' })
  complianceScore: number;

  @Column({ type: 'enum', enum: CycleOutcome })
  outcome: CycleOutcome;
}
