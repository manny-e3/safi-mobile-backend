import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ example: 'd3b07384-d113-4ec2-a5e2-04e8a15714bd' })
  @IsString()
  token: string;

  @ApiProperty({ example: 'newsecurepassword123' })
  @IsString()
  @MinLength(6)
  password: string;
}
