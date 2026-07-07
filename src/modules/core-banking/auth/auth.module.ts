import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { CoreBankingUserModule } from '../user/user.module';
import { CoreBankingWalletModule } from '../wallet/wallet.module';
import { CoreBankingAuthController } from './auth.controller';
import { CoreBankingAuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    CoreBankingUserModule,
    CoreBankingWalletModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.get<string>('JWT_EXPIRES_IN', '1d') as any,
        },
      }),
    }),
  ],
  controllers: [CoreBankingAuthController],
  providers: [CoreBankingAuthService, JwtStrategy],
})
export class CoreBankingAuthModule {}
