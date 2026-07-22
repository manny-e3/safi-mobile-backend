import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreBankingWalletModule } from '../core-banking/wallet/wallet.module';
import { SafiConfig } from './entities/safi-config.entity';
import { SafiCycle } from './entities/safi-cycle.entity';
import { SafiTransaction } from './entities/safi-transaction.entity';
import { SafiOverride } from './entities/safi-override.entity';
import { SafiController } from './safi.controller';
import { SafiService } from './safi.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SafiConfig, SafiCycle, SafiTransaction, SafiOverride]),
    forwardRef(() => CoreBankingWalletModule),
  ],
  controllers: [SafiController],
  providers: [SafiService],
  exports: [SafiService],
})
export class SafiModule {}
