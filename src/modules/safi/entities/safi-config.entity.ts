import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';

export enum GovernanceMode {
  STRICT = 'strict',
  FLEXIBLE = 'flexible',
}

export enum ConfigFrequency {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  BIWEEKLY = 'biweekly',
  MONTHLY = 'monthly',
  CUSTOM = 'custom',
}

export enum CardBehaviour {
  HARD_DECLINE = 'hard_decline',
  AUTO_COVER = 'auto_cover',
  BUFFER = 'buffer',
}

export enum RolloverPreference {
  RETURN_TO_RESERVE = 'return_to_reserve',
  ROLLOVER = 'rollover',
}

@Entity('safi_configs')
export class SafiConfig extends BaseEntity {
  @Column({ type: 'varchar', length: 11, unique: true })
  accountNumber: string;

  @Column({ type: 'bigint' })
  income: string;

  @Column({ type: 'bigint' })
  protectedSum: string;

  @Column({ type: 'bigint' })
  baselineBalance: string;

  @Column({
    type: 'enum',
    enum: GovernanceMode,
    default: GovernanceMode.FLEXIBLE,
  })
  governanceMode: GovernanceMode;

  @Column({ type: 'enum', enum: ConfigFrequency })
  frequency: ConfigFrequency;

  @Column({ type: 'int', nullable: true })
  customDays?: number;

  @Column({ type: 'datetime' })
  expiresAt: Date;

  @Column({
    type: 'enum',
    enum: CardBehaviour,
    default: CardBehaviour.HARD_DECLINE,
  })
  cardBehaviour: CardBehaviour;

  @Column({ type: 'bigint', default: '0' })
  bufferAmount: string;

  @Column({ type: 'bigint', default: '0' })
  remainingBuffer: string;

  @Column({
    type: 'enum',
    enum: RolloverPreference,
    default: RolloverPreference.RETURN_TO_RESERVE,
  })
  rolloverPreference: RolloverPreference;

  @Column({ type: 'boolean', default: false })
  isPaused: boolean;

  @Column({ type: 'int', default: 0 })
  pauseCountThisYear: number;

  @Column({ type: 'datetime', nullable: true })
  pauseStartedAt: Date | null;

  @Column({ type: 'boolean', default: false })
  overrideActive: boolean;
}
