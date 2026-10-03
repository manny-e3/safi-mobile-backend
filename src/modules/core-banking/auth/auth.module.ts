import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { CoreBankingUserModule } from '../user/user.module';
import { CoreBankingWalletModule } from '../wallet/wallet.module';
import { MailModule } from '../../mail/mail.module';
import { CoreBankingAuthController } from './auth.controller';
import { CoreBankingAuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', 'super-secret-key-change-in-prod'),
        signOptions: {
          expiresIn: (config.get('JWT_EXPIRES_IN', '1d') as any),
        },
      }),
    }),
    CoreBankingUserModule,
    CoreBankingWalletModule,
    MailModule,
  ],
  controllers: [CoreBankingAuthController],
  providers: [CoreBankingAuthService, JwtStrategy],
  exports: [CoreBankingAuthService],
})
export class CoreBankingAuthModule {}
