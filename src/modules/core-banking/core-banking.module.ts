import { Module } from '@nestjs/common';
import { CoreBankingAuthModule } from './auth/auth.module';
import { CoreBankingUserModule } from './user/user.module';
import { CoreBankingWalletModule } from './wallet/wallet.module';

@Module({
  imports: [
    CoreBankingUserModule,
    CoreBankingWalletModule,
    CoreBankingAuthModule,
  ],
})
export class CoreBankingModule {}
