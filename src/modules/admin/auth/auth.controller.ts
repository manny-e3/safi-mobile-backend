import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthService } from './auth.service';
import { AdminLoginDto } from './dto/login.dto';
import { AdminRegisterDto } from './dto/register.dto';

@ApiTags('admin / auth')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly authService: AdminAuthService) {}

  @Post('register')
  register(@Body() dto: AdminRegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  login(@Body() dto: AdminLoginDto) {
    return this.authService.login(dto);
  }
}
