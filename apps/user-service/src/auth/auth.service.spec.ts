import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { EmailService } from './email.service';
import { UsersService } from '../users/users.service';

const now = new Date();
const future = new Date(now.getTime() + 60 * 60 * 1000);
const past = new Date(now.getTime() - 60 * 60 * 1000);

const mockUser = {
  id: 'user-uuid-1',
  email: 'test@example.com',
  name: 'Test User',
  passwordHash: '$2b$12$hashedpassword',
  isVerified: true,
  verificationToken: null,
  verificationTokenExpiry: null,
  createdAt: now,
  updatedAt: now,
};

const mockRedis = {
  set: jest.fn().mockResolvedValue('OK'),
  get: jest.fn(),
  del: jest.fn().mockResolvedValue(1),
};

const mockConfig = {
  getOrThrow: jest.fn((key: string) => {
    const values: Record<string, string> = {
      'jwt.secret': 'test-secret',
      'jwt.expiresIn': '15m',
      'app.frontendUrl': 'http://localhost:3000',
    };
    return values[key] ?? '';
  }),
};

describe('AuthService', () => {
  let service: AuthService;
  let users: jest.Mocked<UsersService>;
  let email: jest.Mocked<EmailService>;
  let jwtSign: jest.Mock;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {
            findByEmail: jest.fn(),
            findById: jest.fn(),
            findByVerificationToken: jest.fn(),
            create: jest.fn(),
            verifyEmail: jest.fn(),
          } satisfies Partial<UsersService>,
        },
        {
          provide: EmailService,
          useValue: {
            sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
          } satisfies Partial<EmailService>,
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('mock.access.token'),
          },
        },
        {
          provide: 'REDIS',
          useValue: mockRedis,
        },
        {
          provide: ConfigService,
          useValue: mockConfig,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    users = module.get(UsersService);
    email = module.get(EmailService);
    jwtSign = module.get<JwtService>(JwtService).sign as jest.Mock;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.del.mockResolvedValue(1);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    it('creates user and sends verification email', async () => {
      users.findByEmail.mockResolvedValue(null);
      users.create.mockResolvedValue(mockUser);

      const result = await service.register({
        email: 'test@example.com',
        name: 'Test User',
        password: 'password123',
      });

      expect(users.findByEmail).toHaveBeenCalledWith('test@example.com');
      expect(users.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'test@example.com', name: 'Test User' }),
      );
      expect(email.sendVerificationEmail).toHaveBeenCalledWith(
        'test@example.com',
        expect.stringContaining('/verify?token='),
      );
      expect(result).toHaveProperty('message');
    });

    it('derives name from email when name is omitted', async () => {
      users.findByEmail.mockResolvedValue(null);
      users.create.mockResolvedValue(mockUser);

      await service.register({ email: 'alice@example.com', password: 'password123' });
      expect(users.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'alice' }));
    });

    it('throws ConflictException when email already exists', async () => {
      users.findByEmail.mockResolvedValue(mockUser);
      await expect(
        service.register({ email: 'test@example.com', password: 'password123' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('verifyEmail', () => {
    it('activates account with valid token', async () => {
      users.findByVerificationToken.mockResolvedValue({
        ...mockUser,
        isVerified: false,
        verificationToken: 'valid-token',
        verificationTokenExpiry: future,
      });
      users.verifyEmail.mockResolvedValue({ ...mockUser, isVerified: true });

      const result = await service.verifyEmail({ token: 'valid-token' });
      expect(users.verifyEmail).toHaveBeenCalledWith('user-uuid-1');
      expect(result).toHaveProperty('message');
    });

    it('throws ForbiddenException for expired token', async () => {
      users.findByVerificationToken.mockResolvedValue({
        ...mockUser,
        verificationToken: 'expired-token',
        verificationTokenExpiry: past,
      });
      await expect(service.verifyEmail({ token: 'expired-token' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException for unknown token', async () => {
      users.findByVerificationToken.mockResolvedValue(null);
      await expect(service.verifyEmail({ token: 'bad-token' })).rejects.toThrow(ForbiddenException);
    });
  });

  describe('login', () => {
    it('returns tokens for valid verified credentials', async () => {
      const hash = await bcrypt.hash('password123', 1);
      users.findByEmail.mockResolvedValue({ ...mockUser, passwordHash: hash });
      mockRedis.set.mockResolvedValue('OK');

      const result = await service.login({ email: 'test@example.com', password: 'password123' });
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });

    it('includes iss: yana-stocks in JWT payload for Kong validation', async () => {
      const hash = await bcrypt.hash('password123', 1);
      users.findByEmail.mockResolvedValue({ ...mockUser, passwordHash: hash });

      await service.login({ email: 'test@example.com', password: 'password123' });

      expect(jwtSign).toHaveBeenCalledWith(
        expect.objectContaining({
          iss: 'yana-stocks',
          sub: 'user-uuid-1',
          email: 'test@example.com',
        }),
      );
    });

    it('throws UnauthorizedException for wrong password', async () => {
      const hash = await bcrypt.hash('correct', 1);
      users.findByEmail.mockResolvedValue({ ...mockUser, passwordHash: hash });
      await expect(service.login({ email: 'test@example.com', password: 'wrong' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException for unknown email', async () => {
      users.findByEmail.mockResolvedValue(null);
      await expect(
        service.login({ email: 'unknown@example.com', password: 'pass' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws ForbiddenException for unverified account', async () => {
      const hash = await bcrypt.hash('password123', 1);
      users.findByEmail.mockResolvedValue({ ...mockUser, isVerified: false, passwordHash: hash });
      await expect(
        service.login({ email: 'test@example.com', password: 'password123' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('refresh', () => {
    it('rotates refresh token and returns new pair', async () => {
      mockRedis.get.mockResolvedValue('user-uuid-1');
      users.findById.mockResolvedValue(mockUser);

      const result = await service.refresh('old-refresh-token');
      expect(mockRedis.del).toHaveBeenCalledWith('refresh:old-refresh-token');
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });

    it('includes iss: yana-stocks in JWT payload on token rotation', async () => {
      mockRedis.get.mockResolvedValue('user-uuid-1');
      users.findById.mockResolvedValue(mockUser);

      await service.refresh('old-refresh-token');

      expect(jwtSign).toHaveBeenCalledWith(
        expect.objectContaining({ iss: 'yana-stocks', sub: 'user-uuid-1' }),
      );
    });

    it('throws UnauthorizedException for invalid refresh token', async () => {
      mockRedis.get.mockResolvedValue(null);
      await expect(service.refresh('bad-token')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('deletes refresh token from Redis', async () => {
      const result = await service.logout('my-refresh-token');
      expect(mockRedis.del).toHaveBeenCalledWith('refresh:my-refresh-token');
      expect(result).toHaveProperty('message');
    });
  });

  describe('getProfile', () => {
    it('returns user profile without sensitive fields', async () => {
      users.findById.mockResolvedValue(mockUser);
      const profile = await service.getProfile({
        sub: 'user-uuid-1',
        email: 'test@example.com',
        iat: 0,
        exp: 9999,
      });
      expect(profile).not.toHaveProperty('passwordHash');
      expect(profile).not.toHaveProperty('verificationToken');
      expect(profile.email).toBe('test@example.com');
    });

    it('throws UnauthorizedException when user not found', async () => {
      users.findById.mockResolvedValue(null);
      await expect(
        service.getProfile({ sub: 'gone', email: 'x@x.com', iat: 0, exp: 9999 }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
