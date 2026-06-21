import { NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { UpdateProfileDto } from '@yana-stocks/shared-dto';
import { Profile } from './schemas/profile.schema';
import { ProfileService } from './profile.service';

const mockProfile = {
  userId: 'user-1',
  displayName: 'Ada',
  avatar: '',
  bio: '',
  preferences: { theme: 'dark', defaultCurrency: 'USD', emailNotifications: true },
};

const mockModel = {
  findOne: jest.fn(),
  create: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(),
};

describe('ProfileService', () => {
  let service: ProfileService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProfileService, { provide: getModelToken(Profile.name), useValue: mockModel }],
    }).compile();

    service = module.get<ProfileService>(ProfileService);
    jest.clearAllMocks();
  });

  describe('getMyProfile', () => {
    it('returns existing profile when found', async () => {
      mockModel.findOne.mockResolvedValue(mockProfile);
      const result = await service.getMyProfile('user-1');
      expect(result).toEqual(mockProfile);
      expect(mockModel.findOne).toHaveBeenCalledWith({ userId: 'user-1' });
    });

    it('creates and returns a new profile when none exists', async () => {
      mockModel.findOne.mockResolvedValue(null);
      mockModel.create.mockResolvedValue({ userId: 'user-2', displayName: '' });
      const result = await service.getMyProfile('user-2');
      expect(mockModel.create).toHaveBeenCalledWith({ userId: 'user-2' });
      expect(result).toMatchObject({ userId: 'user-2' });
    });
  });

  describe('updateMyProfile', () => {
    it('applies partial update and returns updated profile', async () => {
      const dto: UpdateProfileDto = { displayName: 'New Name', bio: 'Hello' };
      const updated = { ...mockProfile, displayName: 'New Name', bio: 'Hello' };
      mockModel.findOneAndUpdate.mockResolvedValue(updated);

      const result = await service.updateMyProfile('user-1', dto);

      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        { userId: 'user-1' },
        { $set: { displayName: 'New Name', bio: 'Hello' } },
        { new: true, upsert: true },
      );
      expect(result).toEqual(updated);
    });

    it('applies nested preferences update', async () => {
      const dto: UpdateProfileDto = { preferences: { theme: 'dark', defaultCurrency: 'EUR' } };
      const updated = { ...mockProfile };
      mockModel.findOneAndUpdate.mockResolvedValue(updated);

      await service.updateMyProfile('user-1', dto);

      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        { userId: 'user-1' },
        { $set: { 'preferences.theme': 'dark', 'preferences.defaultCurrency': 'EUR' } },
        { new: true, upsert: true },
      );
    });

    it('throws NotFoundException when findOneAndUpdate returns null', async () => {
      mockModel.findOneAndUpdate.mockResolvedValue(null);
      await expect(service.updateMyProfile('user-1', {})).rejects.toThrow(NotFoundException);
    });
  });

  describe('getPublicProfile', () => {
    it('returns public fields when profile exists', async () => {
      const selectMock = jest
        .fn()
        .mockResolvedValue({ userId: 'user-1', displayName: 'Ada', avatar: '' });
      mockModel.findOne.mockReturnValue({ select: selectMock });

      const result = await service.getPublicProfile('user-1');

      expect(result).toEqual({ userId: 'user-1', displayName: 'Ada', avatar: '' });
      expect(selectMock).toHaveBeenCalledWith('userId displayName avatar');
    });

    it('throws NotFoundException when profile does not exist', async () => {
      const selectMock = jest.fn().mockResolvedValue(null);
      mockModel.findOne.mockReturnValue({ select: selectMock });

      await expect(service.getPublicProfile('unknown')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createDefaultProfile', () => {
    it('upserts with $setOnInsert without throwing', async () => {
      mockModel.updateOne.mockResolvedValue({ upsertedCount: 1 });
      await expect(service.createDefaultProfile('user-3')).resolves.toBeUndefined();
      expect(mockModel.updateOne).toHaveBeenCalledWith(
        { userId: 'user-3' },
        { $setOnInsert: { userId: 'user-3' } },
        { upsert: true },
      );
    });

    it('swallows errors without rethrowing', async () => {
      mockModel.updateOne.mockRejectedValue(new Error('DB error'));
      await expect(service.createDefaultProfile('user-3')).resolves.toBeUndefined();
    });
  });
});
