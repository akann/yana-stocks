import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly mailer: nodemailer.Transporter;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    this.from = this.config.getOrThrow<string>('email.from');
    this.mailer = nodemailer.createTransport({
      host: this.config.getOrThrow<string>('email.host'),
      port: this.config.getOrThrow<number>('email.port'),
      secure: false,
      auth: {
        user: this.config.getOrThrow<string>('email.username'),
        pass: this.config.getOrThrow<string>('email.password'),
      },
    });
  }

  async sendVerificationEmail(to: string, verificationUrl: string): Promise<void> {
    try {
      await this.mailer.sendMail({
        from: this.from,
        to,
        subject: 'Activate your yana-stocks account',
        html: `
          <p>Welcome to yana-stocks!</p>
          <p>Click the link below to activate your account:</p>
          <p><a href="${verificationUrl}">${verificationUrl}</a></p>
          <p>This link expires in 24 hours.</p>
        `,
      });
      this.logger.log('Verification email sent to %s', to);
    } catch (err) {
      this.logger.error('Failed to send verification email to %s: %s', to, err);
    }
  }
}
