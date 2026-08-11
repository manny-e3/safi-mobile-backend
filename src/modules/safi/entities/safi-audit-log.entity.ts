import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';

@Entity('safi_audit_logs')
export class SafiAuditLog extends BaseEntity {
  @Column({ type: 'varchar', length: 100 })
  actor: string;

  @Column({ type: 'text' })
  action: string;
}
