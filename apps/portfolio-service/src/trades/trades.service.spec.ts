import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Trade } from './schemas/trade.schema';
import { TradesService } from './trades.service';

const mockTrades = [
  {
    _id: 'trade-1',
    portfolioId: 'portfolio-1',
    userId: 'user-1',
    symbol: 'AAPL',
    type: 'buy',
    shares: 10,
    price: 150,
    totalAmount: 1500,
    executedAt: new Date('2024-01-02T10:00:00Z'),
  },
  {
    _id: 'trade-2',
    portfolioId: 'portfolio-1',
    userId: 'user-1',
    symbol: 'MSFT',
    type: 'buy',
    shares: 5,
    price: 300,
    totalAmount: 1500,
    executedAt: new Date('2024-01-01T09:00:00Z'),
  },
];

describe('TradesService', () => {
  let service: TradesService;
  let tradeModel: { find: jest.Mock };

  beforeEach(async () => {
    tradeModel = {
      find: jest.fn().mockReturnValue({
        sort: () => ({ lean: () => ({ exec: () => Promise.resolve(mockTrades) }) }),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [TradesService, { provide: getModelToken(Trade.name), useValue: tradeModel }],
    }).compile();

    service = module.get(TradesService);
  });

  describe('findAllByUser', () => {
    it('queries by userId and returns mapped trade objects', async () => {
      const result = await service.findAllByUser('user-1');

      expect(tradeModel.find).toHaveBeenCalledWith({ userId: 'user-1' });
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(
        expect.objectContaining({
          id: 'trade-1',
          symbol: 'AAPL',
          type: 'buy',
          shares: 10,
          price: 150,
          totalAmount: 1500,
        }),
      );
    });

    it('returns an empty array when the user has no trades', async () => {
      tradeModel.find.mockReturnValue({
        sort: () => ({ lean: () => ({ exec: () => Promise.resolve([]) }) }),
      });

      const result = await service.findAllByUser('user-with-no-trades');
      expect(result).toEqual([]);
    });
  });
});
