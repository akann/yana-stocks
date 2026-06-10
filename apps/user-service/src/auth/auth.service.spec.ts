import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { RedisService } from '../redis/redis.service';
import { UsersService } from '../users/users.service';

const mockUser = {
  id: 'user-id-1',
  email: 'test@example.com',
  name: 'Test User',
  password: '$2b$12$hashedpassword',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AuthService', () => {
  let service: AuthService;
  let users: jest.Mocked<UsersService>;
  let jwtService: jest.Mocked<JwtService>;
  let redis: jest.Mocked<RedisService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {
            findByEmail: jest.fn(),
            findById: jest.fn(),
            create: jest.fn(),
            validatePassword: jest.fn(),
          } satisfies Partial<UsersService>,
        },
        {
          provide: JwtService,
          useValue: { sign: jest.fn().mockReturnValue('signed-token') },
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockImplementation((key: string) => {
              const values: Record<string, unknown> = {
                'jwt.secret': 'test-secret',
                'jwt.expiresIn': '15m',
                'jwtRefresh.ttlSeconds': 604800,
              };
              return values[key];
            }),
          },
        },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn(),
            setex: jest.fn().mockResolvedValue(undefined),
            del: jest.fn().mockResolvedValue(undefined),
          } satisfies Partial<RedisService>,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    users = module.get(UsersService);
    jwtService = module.get(JwtService);
    redis = module.get(RedisService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    it('returns access and refresh tokens on success', async () => {
      users.create.mockResolvedValue(mockUser);

      const result = await service.register({
        email: mockUser.email,
        name: mockUser.name,
        password: 'plainpassword',
      });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(jwtService.sign).toHaveBeenCalledWith({ sub: mockUser.id, email: mockUser.email });
      expect(redis.setex).toHaveBeenCalled();
    });
  });

  describe('validateUser', () => {
    it('returns null when user is not found', async () => {
      users.findByEmail.mockResolvedValue(null);
      expect(await service.validateUser('nobody@example.com', 'pass')).toBeNull();
    });

    it('returns null when password is wrong', async () => {
      users.findByEmail.mockResolvedValue(mockUser);
      users.validatePassword.mockResolvedValue(false);
      expect(await service.validateUser(mockUser.email, 'wrongpass')).toBeNull();
    });

    it('returns user without password on success', async () => {
      users.findByEmail.mockResolvedValue(mockUser);
      users.validatePassword.mockResolvedValue(true);
      const result = await service.validateUser(mockUser.email, 'correctpass');
      expect(result).not.toBeNull();
      expect(result).not.toHaveProperty('password');
      expect(result?.id).toBe(mockUser.id);
    });
  });

  describe('refreshTokens', () => {
    it('throws UnauthorizedException when token is not in Redis', async () => {
      redis.get.mockResolvedValue(null);
      await expect(service.refreshTokens('invalid-token')).rejects.toThrow(UnauthorizedException);
    });

    it('rotates tokens when refresh token is valid', async () => {
      redis.get.mockResolvedValue(mockUser.id);
      users.findById.mockResolvedValue(mockUser);

      const result = await service.refreshTokens('valid-token');

      expect(redis.del).toHaveBeenCalledWith('refresh:valid-token');
      expect(redis.setex).toHaveBeenCalled();
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });
  });

  describe('logout', () => {
    it('deletes the refresh token from Redis', async () => {
      await service.logout('some-refresh-token');
      expect(redis.del).toHaveBeenCalledWith('refresh:some-refresh-token');
    });
  });
});
