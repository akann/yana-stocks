import { Injectable } from '@nestjs/common';
import type { RegisterDto } from '@yana-stocks/shared-dto';
import type { JwtPayload } from '@yana-stocks/shared-types';
import { AuthentikService } from './authentik.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly authentik: AuthentikService,
    private readonly users: UsersService,
  ) {}

  async register(dto: RegisterDto): Promise<{ message: string }> {
    const name = dto.name ?? dto.email.split('@')[0]!;
    const authentikUser = await this.authentik.createUser(dto.email, name);
    await this.authentik.triggerEmailVerification(authentikUser.pk);
    return { message: 'Verification email sent. Please check your inbox to activate your account.' };
  }

  async findOrCreateProfile(claims: JwtPayload) {
    return this.users.findOrCreateByAuthentikId(claims.sub, claims.email, claims.name ?? null);
  }
}
