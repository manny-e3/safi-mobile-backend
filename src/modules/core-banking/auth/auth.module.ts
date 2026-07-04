import { Module } from '@nestjs/common';
import { CoreBankingAuthController } from './auth.controller';
import { CoreBankingAuthService } from './auth.service';

@Module({
  controllers: [CoreBankingAuthController],
  providers: [CoreBankingAuthService],
})
export class CoreBankingAuthModule {}
