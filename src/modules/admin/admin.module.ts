import { Module } from '@nestjs/common';
import { AdminAuthModule } from './auth/auth.module';

@Module({
  imports: [AdminAuthModule],
})
export class AdminModule {}
