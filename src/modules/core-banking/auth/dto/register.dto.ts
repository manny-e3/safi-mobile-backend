import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'Alexander Wright' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'alexander.wright@meridian.bank' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiPropertyOptional({ example: '+234 802 345 6789' })
  @IsOptional()
  @IsString()
  phone?: string;
}
