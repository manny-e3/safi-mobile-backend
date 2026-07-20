import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNumberString, IsOptional, Length, Min } from 'class-validator';
import {
  ConfigFrequency,
  GovernanceMode,
} from '../entities/safi-config.entity';

export class CreateSafiConfigDto {
  @ApiProperty({
    example: '01234567890',
    description: '11-digit account number this config applies to',
  })
  @IsNumberString()
  @Length(11, 11)
  accountNumber: string;

  @ApiProperty({
    example: 500000,
    description: 'Income in the smallest currency unit (e.g. kobo)',
  })
  @IsInt()
  @Min(0)
  income: number;

  @ApiProperty({
    example: 100000,
    description:
      'Amount of income protected from withdrawal, in the smallest currency unit',
  })
  @IsInt()
  @Min(0)
  protectedSum: number;

  @ApiProperty({ enum: GovernanceMode, example: GovernanceMode.FLEXIBLE })
  @IsEnum(GovernanceMode)
  governanceMode: GovernanceMode;

  @ApiProperty({
    enum: ConfigFrequency,
    example: ConfigFrequency.MONTHLY,
    description: 'How often this config renews before it expires',
  })
  @IsEnum(ConfigFrequency)
  frequency: ConfigFrequency;

  @ApiProperty({
    example: 15,
    description: 'Custom number of days for custom frequency option',
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  customDays?: number;
}
