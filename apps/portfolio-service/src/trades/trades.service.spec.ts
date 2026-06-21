import { Test, TestingModule } from '@nestjs/testing';
import { TradeRepository } from './trade.repository';
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
  let tradeRepo: jest.Mocked<Pick<TradeRepository, 'findAll'>>;

  beforeEach(async () => {
    tradeRepo = {
      findAll: jest.fn().mockResolvedValue(mockTrades),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [TradesService, { provide: TradeRepository, useValue: tradeRepo }],
    }).compile();

    service = module.get(TradesService);
  });

  describe('findAll', () => {
    it('returns mapped trade objects for the current user', async () => {
      const result = await service.findAll();

      expect(tradeRepo.findAll).toHaveBeenCalled();
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
      tradeRepo.findAll.mockResolvedValue([]);
      const result = await service.findAll();
      expect(result).toEqual([]);
    });
  });
});
