import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class WithdrawWalletDto {
  @ApiProperty({
    example: 200000,
    description: 'Amount in the smallest currency unit (e.g. kobo)',
  })
  @IsInt()
  @Min(1)
  amount: number;

  @ApiPropertyOptional({ example: 'Withdrawal to linked bank account' })
  @IsOptional()
  @IsString()
  description?: string;
}
