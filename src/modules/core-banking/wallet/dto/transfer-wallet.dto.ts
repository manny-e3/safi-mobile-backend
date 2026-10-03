import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class TransferWalletDto {
  @ApiProperty({
    example: 250000,
    description: 'Amount in Naira',
  })
  @IsInt()
  @Min(1)
  amount: number;

  @ApiProperty({
    example: '77462511649',
    description: 'Recipient account number',
  })
  @IsString()
  @IsNotEmpty()
  recipientAccountNumber: string;

  @ApiPropertyOptional({
    example: 'Zenith Bank',
    description: 'Recipient bank name',
  })
  @IsOptional()
  @IsString()
  recipientBank?: string;

  @ApiPropertyOptional({
    example: 'John Doe Enterprise',
    description: 'Recipient account name',
  })
  @IsOptional()
  @IsString()
  recipientName?: string;

  @ApiPropertyOptional({
    example: 'Vendor Payment - Invoice #402',
    description: 'Transaction narration / memo',
  })
  @IsOptional()
  @IsString()
  narration?: string;
}
