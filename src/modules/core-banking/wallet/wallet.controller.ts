import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FundWalletDto } from './dto/fund-wallet.dto';
import { WithdrawWalletDto } from './dto/withdraw-wallet.dto';
import { WalletService } from './wallet.service';

interface AuthenticatedRequest extends FastifyRequest {
  user: { id: string; email: string };
}

@ApiTags('core-banking / wallet')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('core-banking/wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  async getWallet(@Req() req: AuthenticatedRequest) {
    const wallet = await this.walletService.findByUserId(req.user.id);
    if (!wallet) throw new NotFoundException('Wallet not found');
    return wallet;
  }

  @Get('transactions')
  getTransactions(@Req() req: AuthenticatedRequest) {
    return this.walletService.getTransactions(req.user.id);
  }

  @Post('fund')
  fund(@Req() req: AuthenticatedRequest, @Body() dto: FundWalletDto) {
    return this.walletService.fund(
      req.user.id,
      BigInt(dto.amount),
      dto.description,
    );
  }

  @Post('withdraw')
  withdraw(@Req() req: AuthenticatedRequest, @Body() dto: WithdrawWalletDto) {
    return this.walletService.withdraw(
      req.user.id,
      BigInt(dto.amount),
      dto.description,
    );
  }
}
