import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  password: '$2b$12$hashedpassword',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('UsersService', () => {
  let service: UsersService;
  let prisma: { user: { findUnique: jest.Mock; create: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(UsersService);
  });

  describe('findByEmail', () => {
    it('delegates to prisma.user.findUnique with email', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      const result = await service.findByEmail('test@example.com');
      expect(result).toBe(mockUser);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'test@example.com' } });
    });

    it('returns null when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      expect(await service.findByEmail('nobody@example.com')).toBeNull();
    });
  });

  describe('findById', () => {
    it('delegates to prisma.user.findUnique with id', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      const result = await service.findById('user-1');
      expect(result).toBe(mockUser);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    });
  });

  describe('create', () => {
    it('hashes the password and creates the user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('$2b$12$hashed');
      prisma.user.create.mockResolvedValue(mockUser);

      const result = await service.create('test@example.com', 'Test User', 'plainpassword');

      expect(bcrypt.hash).toHaveBeenCalledWith('plainpassword', 12);
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { email: 'test@example.com', name: 'Test User', password: '$2b$12$hashed' },
      });
      expect(result).toBe(mockUser);
    });

    it('throws ConflictException when email is already registered', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(service.create('test@example.com', 'Dupe', 'pass')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('validatePassword', () => {
    it('returns true when passwords match', async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      expect(await service.validatePassword('$2b$12$hashed', 'plainpassword')).toBe(true);
      expect(bcrypt.compare).toHaveBeenCalledWith('plainpassword', '$2b$12$hashed');
    });

    it('returns false when passwords do not match', async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      expect(await service.validatePassword('$2b$12$hashed', 'wrong')).toBe(false);
    });
  });
});
