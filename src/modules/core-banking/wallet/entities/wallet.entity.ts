import { Column, Entity, JoinColumn, OneToOne } from 'typeorm';
import { BaseEntity } from '../../../../common/entities/base.entity';
import { CoreBankingUser } from '../../user/entities/user.entity';

@Entity('core_banking_wallets')
export class Wallet extends BaseEntity {
  @Column({ type: 'varchar', length: 11, unique: true })
  accountNumber: string;

  @Column({ type: 'bigint', default: 0 })
  balance: string;

  @Column()
  userId: string;

  @OneToOne(() => CoreBankingUser, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: CoreBankingUser;
}
