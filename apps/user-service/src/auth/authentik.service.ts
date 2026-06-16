import { ConflictException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface AuthentikUser {
  pk: string;   // UUID in Authentik 2024+ (used for API calls and as JWT sub with sub_mode: user_id)
  username: string;
  email: string;
  name: string;
  is_active: boolean;
}

@Injectable()
export class AuthentikService {
  private readonly logger = new Logger(AuthentikService.name);
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly mailer: nodemailer.Transporter;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.getOrThrow<string>('authentik.apiUrl');
    this.token = this.config.getOrThrow<string>('authentik.apiToken');
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

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.token}`,
    };
  }

  async createUser(email: string, name: string): Promise<AuthentikUser> {
    const res = await fetch(`${this.baseUrl}/api/v3/core/users/`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        username: email,
        email,
        name,
        is_active: false,
        type: 'internal',
      }),
    });

    if (res.status === 400) {
      const body = await res.json() as Record<string, unknown>;
      if (typeof body['username'] === 'object' || typeof body['email'] === 'object') {
        throw new ConflictException('Email already registered');
      }
      throw new InternalServerErrorException('Invalid user data');
    }

    if (!res.ok) {
      const text = await res.text();
      this.logger.error('Authentik createUser failed: %s', text);
      throw new InternalServerErrorException('Failed to create user');
    }

    return res.json() as Promise<AuthentikUser>;
  }

  async triggerEmailVerification(userEmail: string, userPk: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/v3/core/users/${userPk}/recovery/`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error('Authentik recovery link failed for %s: %s', userPk, text);
      return;
    }

    const { link } = await res.json() as { link: string };

    const from = this.config.getOrThrow<string>('email.from');
    try {
      await this.mailer.sendMail({
        from,
        to: userEmail,
        subject: 'Activate your yana-stocks account',
        html: `
          <p>Welcome to yana-stocks!</p>
          <p>Click the link below to activate your account and set your password:</p>
          <p><a href="${link}">${link}</a></p>
          <p>This link expires in 24 hours.</p>
        `,
      });
      this.logger.log('Verification email sent to %s', userEmail);
    } catch (err) {
      this.logger.error('Failed to send verification email to %s: %s', userEmail, err);
    }
  }
}
