import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
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
}
