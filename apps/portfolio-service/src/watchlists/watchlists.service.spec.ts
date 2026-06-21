import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WatchlistRepository } from './watchlist.repository';
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
  let watchlistRepo: jest.Mocked<
    Pick<
      WatchlistRepository,
      'findAll' | 'findById' | 'create' | 'addSymbol' | 'removeSymbol' | 'delete'
    >
  >;

  beforeEach(async () => {
    watchlistRepo = {
      findAll: jest.fn().mockResolvedValue([mockWatchlist]),
      findById: jest.fn().mockResolvedValue(mockWatchlist),
      create: jest.fn().mockResolvedValue(mockWatchlist),
      addSymbol: jest.fn().mockResolvedValue(mockWatchlist),
      removeSymbol: jest.fn().mockResolvedValue(mockWatchlist),
      delete: jest.fn().mockResolvedValue(mockWatchlist),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [WatchlistsService, { provide: WatchlistRepository, useValue: watchlistRepo }],
    }).compile();

    service = module.get(WatchlistsService);
  });

  describe('findAll', () => {
    it('returns all watchlists for the user', async () => {
      const result = await service.findAll();
      expect(watchlistRepo.findAll).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('Tech Stocks');
    });
  });

  describe('findOne', () => {
    it('returns the watchlist when found', async () => {
      const result = await service.findOne('wl-1');
      expect(watchlistRepo.findById).toHaveBeenCalledWith('wl-1');
      expect(result.name).toBe('Tech Stocks');
    });

    it('throws NotFoundException when not found', async () => {
      watchlistRepo.findById.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates a watchlist with the provided symbols', async () => {
      const result = await service.create({ name: 'Tech Stocks', symbols: ['AAPL', 'MSFT'] });
      expect(watchlistRepo.create).toHaveBeenCalledWith('Tech Stocks', ['AAPL', 'MSFT']);
      expect(result.name).toBe('Tech Stocks');
    });

    it('defaults symbols to an empty array when not provided', async () => {
      await service.create({ name: 'Empty List' });
      expect(watchlistRepo.create).toHaveBeenCalledWith('Empty List', []);
    });
  });

  describe('addSymbol', () => {
    it('passes the uppercased symbol to the repository', async () => {
      await service.addSymbol('wl-1', 'tsla');
      expect(watchlistRepo.addSymbol).toHaveBeenCalledWith('wl-1', 'TSLA');
    });

    it('throws NotFoundException when watchlist not found', async () => {
      watchlistRepo.addSymbol.mockResolvedValue(null);
      await expect(service.addSymbol('missing', 'AAPL')).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeSymbol', () => {
    it('passes the uppercased symbol to the repository', async () => {
      await service.removeSymbol('wl-1', 'aapl');
      expect(watchlistRepo.removeSymbol).toHaveBeenCalledWith('wl-1', 'AAPL');
    });

    it('throws NotFoundException when watchlist not found', async () => {
      watchlistRepo.removeSymbol.mockResolvedValue(null);
      await expect(service.removeSymbol('missing', 'AAPL')).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes the watchlist', async () => {
      await service.remove('wl-1');
      expect(watchlistRepo.delete).toHaveBeenCalledWith('wl-1');
    });

    it('throws NotFoundException when watchlist not found', async () => {
      watchlistRepo.delete.mockResolvedValue(null);
      await expect(service.remove('missing')).rejects.toThrow(NotFoundException);
    });
  });
});
