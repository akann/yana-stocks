import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { RegisterDto } from '@yana-stocks/shared-dto';
import type { AuthTokens, JwtPayload } from '@yana-stocks/shared-types';
import { RedisService } from '../redis/redis.service';
import { UsersService } from '../users/users.service';

const REFRESH_PREFIX = 'refresh:';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  async validateUser(email: string, password: string) {
    const user = await this.users.findByEmail(email);
    if (!user) return null;

    const valid = await this.users.validatePassword(user.password, password);
    if (!valid) return null;

    const { password: _, ...safeUser } = user;
    return safeUser;
  }

  async register(dto: RegisterDto): Promise<AuthTokens> {
    const user = await this.users.create(dto.email, dto.name, dto.password);
    const { password: _, ...safeUser } = user;
    return this.issueTokens(safeUser.id, safeUser.email);
  }

  login(user: { id: string; email: string }): Promise<AuthTokens> {
    return this.issueTokens(user.id, user.email);
  }

  async refreshTokens(token: string): Promise<AuthTokens> {
    const userId = await this.redis.get(`${REFRESH_PREFIX}${token}`);
    if (!userId) throw new UnauthorizedException('Invalid or expired refresh token');

    await this.redis.del(`${REFRESH_PREFIX}${token}`);

    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();

    return this.issueTokens(user.id, user.email);
  }

  async logout(token: string): Promise<void> {
    await this.redis.del(`${REFRESH_PREFIX}${token}`);
  }

  private async issueTokens(userId: string, email: string): Promise<AuthTokens> {
    const payload: JwtPayload = { sub: userId, email };
    const accessToken = this.jwt.sign(payload);

    const refreshToken = randomUUID();
    const ttl = this.config.getOrThrow<number>('jwtRefresh.ttlSeconds');
    await this.redis.setex(`${REFRESH_PREFIX}${refreshToken}`, ttl, userId);

    return { accessToken, refreshToken };
  }
}
