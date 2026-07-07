import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class FundWalletDto {
  @ApiProperty({
    example: 500000,
    description: 'Amount in the smallest currency unit (e.g. kobo)',
  })
  @IsInt()
  @Min(1)
  amount: number;

  @ApiPropertyOptional({ example: 'Wallet funding via card' })
  @IsOptional()
  @IsString()
  description?: string;
}
