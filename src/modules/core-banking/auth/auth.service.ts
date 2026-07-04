import { Injectable } from '@nestjs/common';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class CoreBankingAuthService {
  login(dto: LoginDto) {
    return dto;
  }

  register(dto: RegisterDto) {
    return dto;
  }
}
