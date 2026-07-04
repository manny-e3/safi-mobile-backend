import { Module } from '@nestjs/common';
import { AdminAuthController } from './auth.controller';
import { AdminAuthService } from './auth.service';

@Module({
  controllers: [AdminAuthController],
  providers: [AdminAuthService],
})
export class AdminAuthModule {}
