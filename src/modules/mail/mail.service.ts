import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface SendEmailResult {
  messageId: string;
  previewUrl?: string;
  accepted: string[];
}

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private fromEmail = '"Meridian Bank" <security@meridian.bank>';
  private frontendUrl = 'http://localhost:5173';
  private isEthereal = false;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    await this.initTransporter();
  }

  private async initTransporter() {
    const fromAddress =
      this.config.get<string>('MAIL_FROM_ADDRESS') ??
      this.config.get<string>('SMTP_FROM') ??
      this.config.get<string>('MAIL_USERNAME') ??
      'no-reply@fmdqgroup.com';
    const fromName =
      this.config.get<string>('MAIL_FROM_NAME') ??
      'Meridian Bank';
    this.fromEmail = `"${fromName}" <${fromAddress}>`;

    this.frontendUrl =
      this.config.get<string>('FRONTEND_URL') ??
      this.config.get<string>('APP_URL') ??
      'http://localhost:5173';

    const host =
      this.config.get<string>('SMTP_HOST') ??
      this.config.get<string>('MAIL_HOST');
    const port = Number(
      this.config.get<number>('SMTP_PORT') ??
        this.config.get<number>('MAIL_PORT') ??
        587,
    );
    const user =
      this.config.get<string>('SMTP_USER') ??
      this.config.get<string>('MAIL_USERNAME');
    const pass =
      this.config.get<string>('SMTP_PASS') ??
      this.config.get<string>('MAIL_PASSWORD');
    const secure =
      this.config.get<string>('SMTP_SECURE') === 'true' || port === 465;

    if (host && user && pass) {
      this.logger.log(`Configuring SMTP transport via ${host}:${port}`);
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
        tls: { ciphers: 'SSLv3', rejectUnauthorized: false },
      });
      this.isEthereal = false;
    } else {
      this.logger.log(
        'No external SMTP credentials configured. Creating development test mailer (Ethereal)...',
      );
      try {
        const testAccount = await nodemailer.createTestAccount();
        this.transporter = nodemailer.createTransport({
          host: 'smtp.ethereal.email',
          port: 587,
          secure: false,
          auth: {
            user: testAccount.user,
            pass: testAccount.pass,
          },
        });
        this.isEthereal = true;
        this.logger.log(
          `Development test mailer active with Ethereal user: ${testAccount.user}`,
        );
      } catch (err: any) {
        this.logger.warn(
          `Failed to create Ethereal test account: ${err.message}. Using JSON fallback transport.`,
        );
        this.transporter = nodemailer.createTransport({
          jsonTransport: true,
        });
      }
    }
  }

  /**
   * Send Password Reset Email
   */
  async sendPasswordResetEmail(
    to: string,
    name: string,
    resetToken: string,
  ): Promise<SendEmailResult> {
    if (!this.transporter) {
      await this.initTransporter();
    }
    if (!this.transporter) {
      throw new Error('Email transporter could not be initialized');
    }

    const resetUrl = `${this.frontendUrl}/?view=reset_password&token=${resetToken}&email=${encodeURIComponent(to)}`;
    const displayName = name ? name.trim() : 'Valued Client';

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Meridian Bank Password</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0B132B; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #E2E8F0;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #0B132B; padding: 40px 20px;">
    <tr>
      <td align="center">
        <!-- Main Card -->
        <table role="presentation" width="100%" style="max-width: 580px; background-color: #111D38; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; overflow: hidden; box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);">
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #0B132B 0%, #0F2D3E 100%); padding: 32px 36px; border-bottom: 1px solid rgba(255, 255, 255, 0.08);">
              <table role="presentation" width="100%">
                <tr>
                  <td>
                    <div style="display: inline-block; background-color: #0D9488; padding: 10px 12px; border-radius: 10px; vertical-align: middle;">
                      <span style="font-size: 20px; color: #FFFFFF; font-weight: 800;">🛡️</span>
                    </div>
                    <div style="display: inline-block; vertical-align: middle; margin-left: 12px;">
                      <h2 style="margin: 0; color: #FFFFFF; font-size: 20px; font-weight: 700; letter-spacing: -0.5px;">Meridian Bank</h2>
                      <p style="margin: 2px 0 0 0; color: #2DD4BF; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">SAFI Protected Core</p>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding: 36px;">
              <h3 style="margin: 0 0 16px 0; color: #FFFFFF; font-size: 22px; font-weight: 700;">Password Reset Request</h3>
              <p style="margin: 0 0 18px 0; color: #94A3B8; font-size: 15px; line-height: 1.6;">
                Hello <strong>${displayName}</strong>,
              </p>
              <p style="margin: 0 0 24px 0; color: #CBD5E1; font-size: 15px; line-height: 1.6;">
                We received a request to reset the password for your Meridian digital banking account associated with <strong style="color: #FFFFFF;">${to}</strong>.
              </p>

              <!-- Action Button -->
              <table role="presentation" width="100%" style="margin: 30px 0;">
                <tr>
                  <td align="center">
                    <a href="${resetUrl}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #0D9488 0%, #0F766E 100%); color: #FFFFFF; text-decoration: none; font-size: 15px; font-weight: 700; padding: 14px 34px; border-radius: 8px; box-shadow: 0 4px 14px rgba(13, 148, 136, 0.4); letter-spacing: 0.3px;">
                      Reset Password Now &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              

              <!-- Security Notice -->
              <div style="border-left: 3px solid #EAB308; padding-left: 14px; margin: 24px 0;">
                <p style="margin: 0; color: #94A3B8; font-size: 13px; line-height: 1.5;">
                  <strong style="color: #FACC15;">Security Notice:</strong> This password reset link will expire in <strong>1 hour</strong>. If you did not initiate this request, your account is still secure, but we recommend checking your settings.
                </p>
              </div>

              <p style="margin: 24px 0 0 0; color: #64748B; font-size: 13px; line-height: 1.5;">
                Direct link: <a href="${resetUrl}" style="color: #2DD4BF; word-break: break-all;">${resetUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #0B132B; padding: 24px 36px; border-top: 1px solid rgba(255, 255, 255, 0.08); text-align: center;">
              <p style="margin: 0 0 8px 0; color: #64748B; font-size: 12px;">
                &copy; ${new Date().getFullYear()} Meridian Bank PLC. All rights reserved. SAFI Autonomous Protection enabled.
              </p>
              <p style="margin: 0; color: #475569; font-size: 11px;">
                This is an automated security transmission. Please do not reply directly to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();

    const info = await this.transporter!.sendMail({
      from: this.fromEmail,
      to,
      subject: 'Reset Your Meridian Bank Password',
      text: `Hello ${displayName},\n\nWe received a request to reset your password. Click the link below to set a new password:\n${resetUrl}\n\nThis reset link will expire in 1 hour.\n\nMeridian Bank Security`,
      html: htmlContent,
    });

    let previewUrl: string | undefined;
    if (this.isEthereal) {
      const url = nodemailer.getTestMessageUrl(info);
      if (url) {
        previewUrl = url;
        this.logger.log(`\n======================================================\n📨 PASSWORD RESET EMAIL SENT TO: ${to}\n🔗 PREVIEW IN BROWSER: ${previewUrl}\n🔑 RESET TOKEN: ${resetToken}\n======================================================\n`);
      }
    } else {
      this.logger.log(`Password reset email delivered to ${to} (MessageId: ${info.messageId})`);
    }

    return {
      messageId: info.messageId,
      previewUrl,
      accepted: Array.isArray(info.accepted) ? (info.accepted as string[]) : [to],
    };
  }

  /**
   * Send Password Reset Success Notification
   */
  async sendPasswordResetSuccessEmail(
    to: string,
    name: string,
  ): Promise<SendEmailResult> {
    if (!this.transporter) {
      await this.initTransporter();
    }

    const displayName = name ? name.trim() : 'Valued Client';

    const htmlContent = `
<!DOCTYPE html>
<html>
<body style="margin: 0; padding: 0; background-color: #0B132B; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #E2E8F0;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #0B132B; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 580px; background-color: #111D38; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; overflow: hidden;">
          <tr>
            <td style="padding: 32px 36px; border-bottom: 1px solid rgba(255, 255, 255, 0.08);">
              <h2 style="margin: 0; color: #10B981; font-size: 20px; font-weight: 700;">Password Successfully Reset</h2>
            </td>
          </tr>
          <tr>
            <td style="padding: 36px;">
              <p style="margin: 0 0 16px 0; color: #CBD5E1; font-size: 15px; line-height: 1.6;">
                Hello <strong>${displayName}</strong>,
              </p>
              <p style="margin: 0 0 20px 0; color: #94A3B8; font-size: 15px; line-height: 1.6;">
                The password for your Meridian Bank account (<strong style="color: #FFFFFF;">${to}</strong>) was successfully updated. You can now log into your dashboard using your new password.
              </p>
              <div style="border-left: 3px solid #EF4444; padding-left: 14px; margin: 24px 0;">
                <p style="margin: 0; color: #EF4444; font-size: 13px; font-weight: 600;">
                  If you did not make this change, please lock your account or contact Meridian Fraud Prevention immediately.
                </p>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();

    const info = await this.transporter!.sendMail({
      from: this.fromEmail,
      to,
      subject: 'Security Alert: Meridian Bank Password Updated',
      text: `Hello ${displayName},\n\nYour Meridian Bank account password was successfully updated.\n\nIf you did not make this change, contact fraud prevention immediately.`,
      html: htmlContent,
    });

    let previewUrl: string | undefined;
    if (this.isEthereal) {
      const url = nodemailer.getTestMessageUrl(info);
      if (url) {
        previewUrl = url;
        this.logger.log(`\n======================================================\n📨 PASSWORD CHANGED CONFIRMATION EMAIL SENT TO: ${to}\n🔗 PREVIEW IN BROWSER: ${previewUrl}\n======================================================\n`);
      }
    }

    return {
      messageId: info.messageId,
      previewUrl,
      accepted: Array.isArray(info.accepted) ? (info.accepted as string[]) : [to],
    };
  }
}
