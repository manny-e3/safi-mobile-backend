import { Injectable } from '@nestjs/common';
import { AdminLoginDto } from './dto/login.dto';
import { AdminRegisterDto } from './dto/register.dto';

@Injectable()
export class AdminAuthService {
  login(dto: AdminLoginDto) {
    return dto;
  }

  register(dto: AdminRegisterDto) {
    return dto;
  }
}
