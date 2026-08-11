import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';

@Entity('safi_controls')
export class SafiControl extends BaseEntity {
  @Column({ type: 'varchar', length: 50, default: 'Flexible' })
  governanceMode: string;

  @Column({ type: 'simple-array' })
  allowedBehaviours: string[];

  @Column({ type: 'simple-array' })
  activeModes: string[];

  @Column({ type: 'json', nullable: true })
  modeConfigurations: Record<string, { status: string; allowedBehaviours: string[]; description?: string }>;
}

