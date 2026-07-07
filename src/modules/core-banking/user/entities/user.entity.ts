import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../../common/entities/base.entity';

@Entity('core_banking_users')
export class CoreBankingUser extends BaseEntity {
  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @Column({ nullable: true, type: 'varchar' })
  passwordResetToken: string | null;

  @Column({ nullable: true, type: 'timestamp' })
  passwordResetExpires: Date | null;
}
