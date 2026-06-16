import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { AuthentikService } from './authentik.service';
import { UsersService } from '../users/users.service';
import type { JwtPayload } from '@yana-stocks/shared-types';

const mockProfile = {
  id: 'profile-uuid',
  authentikId: 'authentik-uuid-1',
  email: 'test@example.com',
  name: 'Test User',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AuthService', () => {
  let service: AuthService;
  let authentik: jest.Mocked<AuthentikService>;
  let users: jest.Mocked<UsersService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: AuthentikService,
          useValue: {
            createUser: jest.fn(),
            triggerEmailVerification: jest.fn().mockResolvedValue(undefined),
          } satisfies Partial<AuthentikService>,
        },
        {
          provide: UsersService,
          useValue: {
            findOrCreateByAuthentikId: jest.fn(),
          } satisfies Partial<UsersService>,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    authentik = module.get(AuthentikService);
    users = module.get(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    it('creates an Authentik user and triggers email verification', async () => {
      authentik.createUser.mockResolvedValue({
        pk: 'authentik-uuid-1',
        username: 'test@example.com',
        email: 'test@example.com',
        name: 'Test User',
        is_active: false,
      });

      const result = await service.register({ email: 'test@example.com', name: 'Test User' });

      expect(authentik.createUser).toHaveBeenCalledWith('test@example.com', 'Test User');
      expect(authentik.triggerEmailVerification).toHaveBeenCalledWith('authentik-uuid-1');
      expect(result).toHaveProperty('message');
    });

    it('derives name from email when name is omitted', async () => {
      authentik.createUser.mockResolvedValue({
        pk: 'uuid-2',
        username: 'alice@example.com',
        email: 'alice@example.com',
        name: 'alice',
        is_active: false,
      });

      await service.register({ email: 'alice@example.com' });
      expect(authentik.createUser).toHaveBeenCalledWith('alice@example.com', 'alice');
    });

    it('propagates ConflictException from AuthentikService', async () => {
      authentik.createUser.mockRejectedValue(new ConflictException('Email already registered'));
      await expect(service.register({ email: 'dup@example.com' })).rejects.toThrow(ConflictException);
    });
  });

  describe('findOrCreateProfile', () => {
    it('delegates to UsersService with sub, email, and name from claims', async () => {
      users.findOrCreateByAuthentikId.mockResolvedValue(mockProfile);

      const claims: JwtPayload = {
        sub: 'authentik-uuid-1',
        email: 'test@example.com',
        name: 'Test User',
        iss: 'https://authentik.yanatech.co.uk/application/o/yana-stocks/',
        aud: 'yana-stocks',
        iat: 0,
        exp: 9999999999,
      };

      const result = await service.findOrCreateProfile(claims);
      expect(users.findOrCreateByAuthentikId).toHaveBeenCalledWith(
        'authentik-uuid-1',
        'test@example.com',
        'Test User',
      );
      expect(result).toBe(mockProfile);
    });

    it('passes null for name when claim is absent', async () => {
      users.findOrCreateByAuthentikId.mockResolvedValue(mockProfile);
      const claims: JwtPayload = {
        sub: 'uuid',
        email: 'x@example.com',
        iss: 'https://authentik.yanatech.co.uk/application/o/yana-stocks/',
        aud: 'yana-stocks',
        iat: 0,
        exp: 9999999999,
      };
      await service.findOrCreateProfile(claims);
      expect(users.findOrCreateByAuthentikId).toHaveBeenCalledWith('uuid', 'x@example.com', null);
    });
  });
});
