import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthUser } from '../common/current-user.decorator';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { Trade } from '../trades/schemas/trade.schema';
import { PortfoliosService } from './portfolios.service';
import { Portfolio } from './schemas/portfolio.schema';

const mockUser: AuthUser = { id: 'user-1', email: 'user@example.com' };

const mockPortfolioDoc = {
  _id: 'portfolio-1',
  id: 'portfolio-1',
  userId: 'user-1',
  name: 'My Portfolio',
  stocks: [],
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

describe('PortfoliosService', () => {
  let service: PortfoliosService;
  let portfolioModel: {
    find: jest.Mock;
    findById: jest.Mock;
    findOneAndUpdate: jest.Mock;
    findOneAndDelete: jest.Mock;
    create: jest.Mock;
  };
  let tradeModel: { create: jest.Mock };
  let kafkaProducer: jest.Mocked<KafkaProducerService>;

  beforeEach(async () => {
    portfolioModel = {
      find: jest.fn().mockReturnValue({ lean: () => ({ exec: () => Promise.resolve([mockPortfolioDoc]) }) }),
      findById: jest.fn(),
      findOneAndUpdate: jest.fn().mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(mockPortfolioDoc) }) }),
      findOneAndDelete: jest.fn().mockReturnValue({ exec: () => Promise.resolve(mockPortfolioDoc) }),
      create: jest.fn().mockResolvedValue({ ...mockPortfolioDoc, toObject: () => mockPortfolioDoc }),
    };

    tradeModel = { create: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfoliosService,
        { provide: getModelToken(Portfolio.name), useValue: portfolioModel },
        { provide: getModelToken(Trade.name), useValue: tradeModel },
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
      const result = await service.findAll('user-1');
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('My Portfolio');
    });
  });

  describe('create', () => {
    it('creates a portfolio and emits a portfolio_created event', async () => {
      const result = await service.create({ name: 'New Portfolio' }, mockUser);

      expect(result.name).toBe('My Portfolio');
      expect(kafkaProducer.emitPortfolioEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'portfolio_created', userId: 'user-1' }),
      );
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when portfolio does not exist', async () => {
      portfolioModel.findById.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(null) }) });
      await expect(service.findOne('missing', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when portfolio belongs to another user', async () => {
      portfolioModel.findById.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve({ ...mockPortfolioDoc, userId: 'other-user' }) }),
      });
      await expect(service.findOne('portfolio-1', 'user-1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('addStock', () => {
    it('adds a new holding, records a trade, and emits stock_added event', async () => {
      const docMock = {
        ...mockPortfolioDoc,
        stocks: [] as Array<{ symbol: string; shares: number; avgCostBasis: number }>,
        save: jest.fn().mockResolvedValue({
          toObject: () => ({ ...mockPortfolioDoc, stocks: [{ symbol: 'AAPL', shares: 10, avgCostBasis: 150 }] }),
        }),
      };
      portfolioModel.findById.mockReturnValue({ exec: () => Promise.resolve(docMock) });

      await service.addStock('portfolio-1', { symbol: 'AAPL', shares: 10, price: 150 }, mockUser);

      expect(tradeModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ symbol: 'AAPL', type: 'buy', shares: 10, price: 150 }),
      );
      expect(kafkaProducer.emitPortfolioEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'stock_added' }),
      );
    });
  });
});
