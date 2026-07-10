import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SafiConfig } from './entities/safi-config.entity';
import { SafiController } from './safi.controller';
import { SafiService } from './safi.service';

@Module({
  imports: [TypeOrmModule.forFeature([SafiConfig])],
  controllers: [SafiController],
  providers: [SafiService],
  exports: [SafiService],
})
export class SafiModule {}
