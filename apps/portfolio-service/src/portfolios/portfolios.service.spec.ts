import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthUser } from '../common/current-user.decorator';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { TradeRepository } from '../trades/trade.repository';
import { PortfolioRepository } from './portfolio.repository';
import { PortfoliosService } from './portfolios.service';

const mockUser: AuthUser = { id: 'user-1', email: 'user@example.com' };

const mockPortfolioDoc = {
  _id: { toString: () => 'portfolio-1' },
  id: 'portfolio-1',
  userId: 'user-1',
  name: 'My Portfolio',
  stocks: [],
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

describe('PortfoliosService', () => {
  let service: PortfoliosService;
  let portfolioRepo: jest.Mocked<
    Pick<
      PortfolioRepository,
      'findAll' | 'findById' | 'create' | 'updateName' | 'delete' | 'findByIdForMutation'
    >
  >;
  let tradeRepo: jest.Mocked<Pick<TradeRepository, 'record'>>;
  let kafkaProducer: jest.Mocked<KafkaProducerService>;

  beforeEach(async () => {
    portfolioRepo = {
      findAll: jest.fn().mockResolvedValue([mockPortfolioDoc]),
      findById: jest.fn().mockResolvedValue(mockPortfolioDoc),
      create: jest.fn().mockResolvedValue({
        toObject: () => mockPortfolioDoc,
      }),
      updateName: jest.fn().mockResolvedValue(mockPortfolioDoc),
      delete: jest.fn().mockResolvedValue(mockPortfolioDoc),
      findByIdForMutation: jest.fn().mockResolvedValue({
        ...mockPortfolioDoc,
        stocks: [] as Array<{ symbol: string; shares: number; avgCostBasis: number }>,
        save: jest.fn().mockResolvedValue({
          toObject: () => ({
            ...mockPortfolioDoc,
            stocks: [{ symbol: 'AAPL', shares: 10, avgCostBasis: 150 }],
          }),
        }),
      }),
    };

    tradeRepo = {
      record: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfoliosService,
        { provide: PortfolioRepository, useValue: portfolioRepo },
        { provide: TradeRepository, useValue: tradeRepo },
        {
          provide: KafkaProducerService,
          useValue: {
            emitPortfolioEvent: jest.fn().mockResolvedValue(undefined),
          } satisfies Partial<KafkaProducerService>,
        },
      ],
    }).compile();

    service = module.get<PortfoliosService>(PortfoliosService);
    kafkaProducer = module.get(KafkaProducerService);
  });

  describe('findAll', () => {
    it('returns portfolios for the user', async () => {
      const result = await service.findAll();
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('My Portfolio');
      expect(portfolioRepo.findAll).toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('creates a portfolio and emits a portfolio_created event', async () => {
      const result = await service.create({ name: 'New Portfolio' }, mockUser);

      expect(portfolioRepo.create).toHaveBeenCalledWith('New Portfolio');
      expect(result.name).toBe('My Portfolio');
      expect(kafkaProducer.emitPortfolioEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'portfolio_created', userId: 'user-1' }),
      );
    });
  });

  describe('findOne', () => {
    it('returns the portfolio when found', async () => {
      const result = await service.findOne('portfolio-1');
      expect(result.id).toBe('portfolio-1');
      expect(portfolioRepo.findById).toHaveBeenCalledWith('portfolio-1');
    });

    it('throws NotFoundException when portfolio does not exist', async () => {
      portfolioRepo.findById.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when portfolio belongs to another user', async () => {
      portfolioRepo.findById.mockResolvedValue(null);
      await expect(service.findOne('portfolio-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('renames the portfolio and returns the updated document', async () => {
      const updated = { ...mockPortfolioDoc, name: 'Renamed' };
      portfolioRepo.updateName.mockResolvedValue(updated);

      const result = await service.update('portfolio-1', { name: 'Renamed' });

      expect(portfolioRepo.updateName).toHaveBeenCalledWith('portfolio-1', 'Renamed');
      expect(result.name).toBe('Renamed');
    });

    it('throws NotFoundException when the portfolio is not found', async () => {
      portfolioRepo.updateName.mockResolvedValue(null);
      await expect(service.update('missing', { name: 'X' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes the portfolio', async () => {
      await service.remove('portfolio-1');
      expect(portfolioRepo.delete).toHaveBeenCalledWith('portfolio-1');
    });

    it('throws NotFoundException when the portfolio is not found', async () => {
      portfolioRepo.delete.mockResolvedValue(null);
      await expect(service.remove('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('addStock', () => {
    it('adds a new holding, records a trade, and emits stock_added event', async () => {
      await service.addStock('portfolio-1', { symbol: 'AAPL', shares: 10, price: 150 }, mockUser);

      expect(portfolioRepo.findByIdForMutation).toHaveBeenCalledWith('portfolio-1');
      expect(tradeRepo.record).toHaveBeenCalledWith(
        expect.objectContaining({ symbol: 'AAPL', type: 'buy', shares: 10, price: 150 }),
      );
      expect(kafkaProducer.emitPortfolioEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'stock_added' }),
      );
    });

    it('averages cost basis when the symbol already exists in the portfolio', async () => {
      const existing = { symbol: 'AAPL', shares: 10, avgCostBasis: 100 };
      portfolioRepo.findByIdForMutation.mockResolvedValue({
        ...mockPortfolioDoc,
        stocks: [existing],
        save: jest.fn().mockResolvedValue({
          toObject: () => ({
            ...mockPortfolioDoc,
            stocks: [{ symbol: 'AAPL', shares: 20, avgCostBasis: 110 }],
          }),
        }),
      } as unknown as Awaited<ReturnType<PortfolioRepository['findByIdForMutation']>>);

      await service.addStock('portfolio-1', { symbol: 'AAPL', shares: 10, price: 120 }, mockUser);

      // (10*100 + 10*120) / 20 = 110
      expect(existing.shares).toBe(20);
      expect(existing.avgCostBasis).toBe(110);
    });

    it('throws NotFoundException when portfolio belongs to another user', async () => {
      portfolioRepo.findByIdForMutation.mockResolvedValue(null);

      await expect(
        service.addStock('portfolio-1', { symbol: 'AAPL', shares: 5, price: 150 }, mockUser),
      ).rejects.toThrow(NotFoundException);
      expect(portfolioRepo.findByIdForMutation).toHaveBeenCalledWith('portfolio-1');
    });
  });
});
