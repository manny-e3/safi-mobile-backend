import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';

export enum GovernanceMode {
  STRICT = 'strict',
  FLEXIBLE = 'flexible',
}

export enum ConfigFrequency {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

@Entity('safi_configs')
export class SafiConfig extends BaseEntity {
  @Column({ type: 'varchar', length: 11, unique: true })
  accountNumber: string;

  @Column({ type: 'bigint' })
  income: string;

  @Column({ type: 'bigint' })
  protectedSum: string;

  @Column({
    type: 'enum',
    enum: GovernanceMode,
    default: GovernanceMode.FLEXIBLE,
  })
  governanceMode: GovernanceMode;

  @Column({ type: 'enum', enum: ConfigFrequency })
  frequency: ConfigFrequency;

  @Column({ type: 'timestamp' })
  expiresAt: Date;
}
