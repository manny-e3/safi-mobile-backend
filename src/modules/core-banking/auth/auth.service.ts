import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { UserService } from '../user/user.service';
import { WalletService } from '../wallet/wallet.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';

@Injectable()
export class CoreBankingAuthService {
  constructor(
    private readonly userService: UserService,
    private readonly walletService: WalletService,
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.userService.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already in use');

    const password = await bcrypt.hash(dto.password, 10);

    const user = await this.dataSource.transaction(async (manager) => {
      const createdUser = await this.userService.create(
        { ...dto, password },
        manager,
      );
      await this.walletService.createForUser(createdUser.id, manager);
      return createdUser;
    });

    return { accessToken: this.signToken(user.id, user.email) };
  }

  async login(dto: LoginDto) {
    const user = await this.userService.findByEmail(dto.email);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return { accessToken: this.signToken(user.id, user.email) };
  }

  logout() {
    return { message: 'Logged out successfully' };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.userService.findByEmail(dto.email);
    if (!user) throw new NotFoundException('No account found with this email');

    const resetToken = crypto.randomUUID();
    const expires = new Date();
    expires.setHours(expires.getHours() + 1);

    user.passwordResetToken = resetToken;
    user.passwordResetExpires = expires;
    await this.userService.save(user);

    // TODO: send resetToken via email — do not expose in production
    return { message: 'Password reset instructions sent' };
  }

  private signToken(userId: string, email: string): string {
    return this.jwtService.sign({ sub: userId, email });
  }
}
