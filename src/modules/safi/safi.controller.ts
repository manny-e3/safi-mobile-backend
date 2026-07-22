import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CreateSafiConfigDto } from './dto/create-safi-config.dto';
import { UpdateSafiConfigDto } from './dto/update-safi-config.dto';
import { SafiService } from './safi.service';

@ApiTags('safi')
@Controller('safi')
export class SafiController {
  constructor(private readonly safiService: SafiService) {}

  @Post('config')
  create(@Body() dto: CreateSafiConfigDto) {
    return this.safiService.create(dto);
  }

  @Get('config/:accountNumber')
  getByAccountNumber(@Param('accountNumber') accountNumber: string) {
    return this.safiService.getByAccountNumber(accountNumber);
  }

  @Patch('config/:accountNumber')
  update(
    @Param('accountNumber') accountNumber: string,
    @Body() dto: UpdateSafiConfigDto,
  ) {
    return this.safiService.update(accountNumber, dto);
  }

  @Get('config/:accountNumber/dashboard')
  getDashboard(@Param('accountNumber') accountNumber: string) {
    return this.safiService.getDashboard(accountNumber);
  }

  @Get('config/:accountNumber/history')
  getHistory(@Param('accountNumber') accountNumber: string) {
    return this.safiService.getHistory(accountNumber);
  }

  @Delete('config/:accountNumber')
  deactivate(@Param('accountNumber') accountNumber: string) {
    return this.safiService.deactivate(accountNumber);
  }

  @Post('config/:accountNumber/pause')
  pause(@Param('accountNumber') accountNumber: string) {
    return this.safiService.pause(accountNumber);
  }

  @Post('config/:accountNumber/resume')
  resume(@Param('accountNumber') accountNumber: string) {
    return this.safiService.resume(accountNumber);
  }

  @Post('config/:accountNumber/override')
  manualOverride(
    @Param('accountNumber') accountNumber: string,
    @Body() body: { reason: string; amount: string },
  ) {
    return this.safiService.manualOverride(accountNumber, body.reason, body.amount);
  }

  @Get('config/:accountNumber/projection')
  getProjection(@Param('accountNumber') accountNumber: string) {
    return this.safiService.getProjection(accountNumber);
  }
}
