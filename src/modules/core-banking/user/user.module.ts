import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreBankingUser } from './entities/user.entity';
import { UserService } from './user.service';

@Module({
  imports: [TypeOrmModule.forFeature([CoreBankingUser])],
  providers: [UserService],
  exports: [UserService],
})
export class CoreBankingUserModule {}
