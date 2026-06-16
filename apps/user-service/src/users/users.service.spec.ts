import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

const mockProfile = {
  id: 'profile-1',
  authentikId: 'ak-uuid-1',
  email: 'test@example.com',
  name: 'Test User',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('UsersService', () => {
  let service: UsersService;
  let prisma: { userProfile: { findUnique: jest.Mock; create: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      userProfile: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(UsersService);
  });

  describe('findByAuthentikId', () => {
    it('returns profile when found', async () => {
      prisma.userProfile.findUnique.mockResolvedValue(mockProfile);
      const result = await service.findByAuthentikId('ak-uuid-1');
      expect(result).toBe(mockProfile);
      expect(prisma.userProfile.findUnique).toHaveBeenCalledWith({ where: { authentikId: 'ak-uuid-1' } });
    });

    it('returns null when not found', async () => {
      prisma.userProfile.findUnique.mockResolvedValue(null);
      expect(await service.findByAuthentikId('unknown')).toBeNull();
    });
  });

  describe('findOrCreateByAuthentikId', () => {
    it('returns existing profile without creating', async () => {
      prisma.userProfile.findUnique.mockResolvedValue(mockProfile);
      const result = await service.findOrCreateByAuthentikId('ak-uuid-1', 'test@example.com', 'Test User');
      expect(result).toBe(mockProfile);
      expect(prisma.userProfile.create).not.toHaveBeenCalled();
    });

    it('creates and returns a new profile when not found', async () => {
      prisma.userProfile.findUnique.mockResolvedValue(null);
      prisma.userProfile.create.mockResolvedValue(mockProfile);

      const result = await service.findOrCreateByAuthentikId('ak-uuid-1', 'test@example.com', 'Test User');

      expect(prisma.userProfile.create).toHaveBeenCalledWith({
        data: { authentikId: 'ak-uuid-1', email: 'test@example.com', name: 'Test User' },
      });
      expect(result).toBe(mockProfile);
    });

    it('creates profile with null name when name is absent', async () => {
      prisma.userProfile.findUnique.mockResolvedValue(null);
      prisma.userProfile.create.mockResolvedValue({ ...mockProfile, name: null });

      await service.findOrCreateByAuthentikId('ak-uuid-2', 'noname@example.com', null);

      expect(prisma.userProfile.create).toHaveBeenCalledWith({
        data: { authentikId: 'ak-uuid-2', email: 'noname@example.com', name: null },
      });
    });
  });
});
