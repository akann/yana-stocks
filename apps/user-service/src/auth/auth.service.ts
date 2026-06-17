import { ConflictException, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { LoginDto, RegisterDto, VerifyEmailDto } from '@yana-stocks/shared-dto';
import type { JwtPayload } from '@yana-stocks/shared-types';
import { EmailService } from './email.service';
import { UsersService } from '../users/users.service';

const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    @Inject('REDIS') private readonly redis: Redis,
  ) {}

  async register(dto: RegisterDto): Promise<{ message: string }> {
    const existing = await this.users.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already registered');

    const name = dto.name ?? dto.email.split('@')[0]!;
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const verificationToken = randomBytes(32).toString('hex');
    const verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await this.users.create({ email: dto.email, name, passwordHash, verificationToken, verificationTokenExpiry });

    const frontendUrl = this.config.getOrThrow<string>('app.frontendUrl');
    const verificationUrl = `${frontendUrl}/verify?token=${verificationToken}`;
    await this.email.sendVerificationEmail(dto.email, verificationUrl);

    return { message: 'Verification email sent. Please check your inbox to activate your account.' };
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<{ message: string }> {
    const user = await this.users.findByVerificationToken(dto.token);
    if (!user || !user.verificationTokenExpiry) throw new ForbiddenException('Invalid or expired token');
    if (user.verificationTokenExpiry < new Date()) throw new ForbiddenException('Verification token expired');

    await this.users.verifyEmail(user.id);
    return { message: 'Email verified. You can now sign in.' };
  }

  async login(dto: LoginDto): Promise<{ accessToken: string; refreshToken: string }> {
    const user = await this.users.findByEmail(dto.email);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const passwordMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatch) throw new UnauthorizedException('Invalid credentials');

    if (!user.isVerified) throw new ForbiddenException('Please verify your email before signing in');

    return this.issueTokens(user.id, user.email, user.name ?? undefined);
  }

  async refresh(token: string): Promise<{ accessToken: string; refreshToken: string }> {
    const userId = await this.redis.get(`refresh:${token}`);
    if (!userId) throw new UnauthorizedException('Invalid or expired refresh token');

    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException('User not found');

    await this.redis.del(`refresh:${token}`);
    return this.issueTokens(user.id, user.email, user.name ?? undefined);
  }

  async logout(token: string): Promise<{ message: string }> {
    await this.redis.del(`refresh:${token}`);
    return { message: 'Logged out successfully' };
  }

  async getProfile(claims: JwtPayload) {
    const user = await this.users.findById(claims.sub);
    if (!user) throw new UnauthorizedException('User not found');
    const { passwordHash: _ph, verificationToken: _vt, verificationTokenExpiry: _vte, ...profile } = user;
    return profile;
  }

  private async issueTokens(userId: string, email: string, name?: string) {
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = { sub: userId, email, iss: 'yana-stocks', ...(name ? { name } : {}) };
    const accessToken = this.jwt.sign(payload);

    const refreshToken = randomBytes(40).toString('hex');
    await this.redis.set(`refresh:${refreshToken}`, userId, 'EX', REFRESH_TTL_SECONDS);

    return { accessToken, refreshToken };
  }
}
