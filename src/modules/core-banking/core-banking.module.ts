import { Module } from '@nestjs/common';
import { CoreBankingAuthModule } from './auth/auth.module';

@Module({
  imports: [CoreBankingAuthModule],
})
export class CoreBankingModule {}
