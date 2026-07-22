import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';

export enum OverrideType {
  MANUAL = 'manual',
  AUTO_COVER = 'auto_cover',
  LIMIT_BREACH = 'limit_breach',
}

@Entity('safi_overrides')
export class SafiOverride extends BaseEntity {
  @Index()
  @Column({ type: 'varchar', length: 11 })
  accountNumber: string;

  @Column({ type: 'enum', enum: OverrideType })
  type: OverrideType;

  @Column({ type: 'text', nullable: true })
  reason?: string;

  @Column({ type: 'bigint' })
  amount: string;
}
