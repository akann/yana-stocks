import { ConflictException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.getOrThrow<string>('authentik.apiUrl');
    this.token = this.config.getOrThrow<string>('authentik.apiToken');
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

  async triggerEmailVerification(userPk: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/v3/core/users/${userPk}/recovery/`, {
      method: 'POST',
      headers: this.headers,
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error('Authentik recovery link failed for %s: %s', userPk, text);
      // Non-fatal: user was created; recovery link failure should not block the response
      return;
    }

    // In dev you can inspect the link here; in production Authentik sends the email
    // via its configured email backend when the recovery flow has an email stage.
    const { link } = await res.json() as { link: string };
    this.logger.debug('Recovery link for %s: %s', userPk, link);
  }
}
