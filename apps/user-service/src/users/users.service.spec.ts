import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

const now = new Date();
const mockUser = {
  id: 'profile-1',
  email: 'test@example.com',
  name: 'Test User',
  passwordHash: '$2b$12$hash',
  isVerified: false,
  verificationToken: 'token-abc',
  verificationTokenExpiry: new Date(now.getTime() + 60000),
  createdAt: now,
  updatedAt: now,
};

describe('UsersService', () => {
  let service: UsersService;
  let prisma: { userProfile: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      userProfile: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(UsersService);
  });

  describe('findByEmail', () => {
    it('returns user when found', async () => {
      prisma.userProfile.findUnique.mockResolvedValue(mockUser);
      const result = await service.findByEmail('test@example.com');
      expect(result).toBe(mockUser);
      expect(prisma.userProfile.findUnique).toHaveBeenCalledWith({ where: { email: 'test@example.com' } });
    });

    it('returns null when not found', async () => {
      prisma.userProfile.findUnique.mockResolvedValue(null);
      expect(await service.findByEmail('unknown@example.com')).toBeNull();
    });
  });

  describe('findById', () => {
    it('returns user by id', async () => {
      prisma.userProfile.findUnique.mockResolvedValue(mockUser);
      const result = await service.findById('profile-1');
      expect(result).toBe(mockUser);
    });
  });

  describe('findByVerificationToken', () => {
    it('returns user by verification token', async () => {
      prisma.userProfile.findUnique.mockResolvedValue(mockUser);
      const result = await service.findByVerificationToken('token-abc');
      expect(result).toBe(mockUser);
    });
  });

  describe('create', () => {
    it('creates a user with the given data', async () => {
      prisma.userProfile.create.mockResolvedValue(mockUser);
      const data = {
        email: 'test@example.com',
        name: 'Test User',
        passwordHash: '$2b$12$hash',
        verificationToken: 'token-abc',
        verificationTokenExpiry: now,
      };
      const result = await service.create(data);
      expect(result).toBe(mockUser);
      expect(prisma.userProfile.create).toHaveBeenCalledWith({
        data: { ...data, isVerified: false },
      });
    });
  });

  describe('verifyEmail', () => {
    it('sets isVerified=true and clears token fields', async () => {
      prisma.userProfile.update.mockResolvedValue({ ...mockUser, isVerified: true, verificationToken: null });
      await service.verifyEmail('profile-1');
      expect(prisma.userProfile.update).toHaveBeenCalledWith({
        where: { id: 'profile-1' },
        data: { isVerified: true, verificationToken: null, verificationTokenExpiry: null },
      });
    });
  });
});
