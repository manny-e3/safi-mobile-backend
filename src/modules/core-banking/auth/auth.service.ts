import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { DataSource } from 'typeorm';
import { MailService } from '../../mail/mail.service';
import { UserService } from '../user/user.service';
import { WalletService } from '../wallet/wallet.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@Injectable()
export class CoreBankingAuthService {
  constructor(
    private readonly userService: UserService,
    private readonly walletService: WalletService,
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
    private readonly mailService: MailService,
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

    return {
      accessToken: this.signToken(user.id, user.email),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
      },
    };
  }

  async login(dto: LoginDto) {
    const user = await this.userService.findByEmail(dto.email);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return {
      accessToken: this.signToken(user.id, user.email),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
      },
    };
  }

  logout() {
    return { message: 'Logged out successfully' };
  }

  async getProfile(userId: string) {
    const user = await this.userService.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const wallet = await this.walletService.findByUserId(userId);

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
      },
      wallet: wallet
        ? {
            id: wallet.id,
            accountNumber: wallet.accountNumber,
            balance: wallet.balance,
          }
        : null,
    };
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

    // Send email via nodemailer
    try {
      await this.mailService.sendPasswordResetEmail(
        user.email,
        user.name,
        resetToken,
      );
    } catch (err: any) {
      console.error('Failed to send password reset email:', err);
      throw new InternalServerErrorException(
        'Failed to deliver password reset email. Please verify the email or try again later.',
      );
    }

    return {
      message: 'Password reset instructions have been sent to your email address.',
      emailSent: true,
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.userService.findByResetToken(dto.token);
    if (!user) throw new NotFoundException('Invalid or expired reset token');

    const now = new Date();
    if (!user.passwordResetExpires || user.passwordResetExpires < now) {
      throw new ConflictException('Reset token has expired');
    }

    user.password = await bcrypt.hash(dto.password, 10);
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    await this.userService.save(user);

    // Send confirmation email
    try {
      await this.mailService.sendPasswordResetSuccessEmail(
        user.email,
        user.name,
      );
    } catch (err: any) {
      console.error('Failed to send password reset success email:', err);
    }

    return { message: 'Password has been reset successfully' };
  }

  private signToken(userId: string, email: string): string {
    return this.jwtService.sign({ sub: userId, email });
  }
}
