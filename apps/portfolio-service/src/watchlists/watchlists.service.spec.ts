import { NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Watchlist } from './schemas/watchlist.schema';
import { WatchlistsService } from './watchlists.service';

const mockWatchlist = {
  _id: 'wl-1',
  id: 'wl-1',
  userId: 'user-1',
  name: 'Tech Stocks',
  symbols: ['AAPL', 'MSFT'],
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

describe('WatchlistsService', () => {
  let service: WatchlistsService;
  let watchlistModel: {
    find: jest.Mock;
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
    findOneAndDelete: jest.Mock;
    create: jest.Mock;
  };

  beforeEach(async () => {
    watchlistModel = {
      find: jest
        .fn()
        .mockReturnValue({ lean: () => ({ exec: () => Promise.resolve([mockWatchlist]) }) }),
      findOne: jest
        .fn()
        .mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(mockWatchlist) }) }),
      findOneAndUpdate: jest
        .fn()
        .mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(mockWatchlist) }) }),
      findOneAndDelete: jest.fn().mockReturnValue({ exec: () => Promise.resolve(mockWatchlist) }),
      create: jest.fn().mockResolvedValue({
        toObject: () => mockWatchlist,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WatchlistsService,
        { provide: getModelToken(Watchlist.name), useValue: watchlistModel },
      ],
    }).compile();

    service = module.get(WatchlistsService);
  });

  describe('findAll', () => {
    it('returns all watchlists for a user', async () => {
      const result = await service.findAll('user-1');
      expect(watchlistModel.find).toHaveBeenCalledWith({ userId: 'user-1' });
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('Tech Stocks');
    });
  });

  describe('findOne', () => {
    it('returns the watchlist when found', async () => {
      const result = await service.findOne('wl-1', 'user-1');
      expect(watchlistModel.findOne).toHaveBeenCalledWith({ _id: 'wl-1', userId: 'user-1' });
      expect(result.name).toBe('Tech Stocks');
    });

    it('throws NotFoundException when not found', async () => {
      watchlistModel.findOne.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(null) }),
      });
      await expect(service.findOne('missing', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates a watchlist with the provided symbols', async () => {
      const result = await service.create(
        { name: 'Tech Stocks', symbols: ['AAPL', 'MSFT'] },
        'user-1',
      );
      expect(watchlistModel.create).toHaveBeenCalledWith({
        userId: 'user-1',
        name: 'Tech Stocks',
        symbols: ['AAPL', 'MSFT'],
      });
      expect(result.name).toBe('Tech Stocks');
    });

    it('defaults symbols to an empty array when not provided', async () => {
      await service.create({ name: 'Empty List' }, 'user-1');
      expect(watchlistModel.create).toHaveBeenCalledWith(expect.objectContaining({ symbols: [] }));
    });
  });

  describe('addSymbol', () => {
    it('uses $addToSet with the uppercased symbol', async () => {
      await service.addSymbol('wl-1', 'tsla', 'user-1');
      expect(watchlistModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: 'wl-1', userId: 'user-1' },
        { $addToSet: { symbols: 'TSLA' } },
        { new: true },
      );
    });

    it('throws NotFoundException when watchlist not found', async () => {
      watchlistModel.findOneAndUpdate.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(null) }),
      });
      await expect(service.addSymbol('missing', 'AAPL', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('removeSymbol', () => {
    it('uses $pull with the uppercased symbol', async () => {
      await service.removeSymbol('wl-1', 'aapl', 'user-1');
      expect(watchlistModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: 'wl-1', userId: 'user-1' },
        { $pull: { symbols: 'AAPL' } },
        { new: true },
      );
    });

    it('throws NotFoundException when watchlist not found', async () => {
      watchlistModel.findOneAndUpdate.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(null) }),
      });
      await expect(service.removeSymbol('missing', 'AAPL', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('deletes the watchlist', async () => {
      await service.remove('wl-1', 'user-1');
      expect(watchlistModel.findOneAndDelete).toHaveBeenCalledWith({
        _id: 'wl-1',
        userId: 'user-1',
      });
    });

    it('throws NotFoundException when watchlist not found', async () => {
      watchlistModel.findOneAndDelete.mockReturnValue({ exec: () => Promise.resolve(null) });
      await expect(service.remove('missing', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });
});
