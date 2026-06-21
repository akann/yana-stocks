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
    findOne: jest.Mock;
    findById: jest.Mock;
    findOneAndUpdate: jest.Mock;
    findOneAndDelete: jest.Mock;
    create: jest.Mock;
  };
  let tradeModel: { create: jest.Mock };
  let kafkaProducer: jest.Mocked<KafkaProducerService>;

  beforeEach(async () => {
    portfolioModel = {
      find: jest
        .fn()
        .mockReturnValue({ lean: () => ({ exec: () => Promise.resolve([mockPortfolioDoc]) }) }),
      findOne: jest.fn(),
      findById: jest.fn(),
      findOneAndUpdate: jest
        .fn()
        .mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(mockPortfolioDoc) }) }),
      findOneAndDelete: jest
        .fn()
        .mockReturnValue({ exec: () => Promise.resolve(mockPortfolioDoc) }),
      create: jest
        .fn()
        .mockResolvedValue({ ...mockPortfolioDoc, toObject: () => mockPortfolioDoc }),
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
    it('returns the portfolio when it belongs to the user', async () => {
      portfolioModel.findOne.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(mockPortfolioDoc) }),
      });
      const result = await service.findOne('portfolio-1', 'user-1');
      expect(result.id).toBe('portfolio-1');
      expect(result.name).toBe('My Portfolio');
      expect(portfolioModel.findOne).toHaveBeenCalledWith({ _id: 'portfolio-1', userId: 'user-1' });
    });

    it('throws NotFoundException when portfolio does not exist', async () => {
      portfolioModel.findOne.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(null) }),
      });
      await expect(service.findOne('missing', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when portfolio belongs to another user', async () => {
      portfolioModel.findOne.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(null) }),
      });
      await expect(service.findOne('portfolio-1', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('renames the portfolio and returns the updated document', async () => {
      const updated = { ...mockPortfolioDoc, name: 'Renamed' };
      portfolioModel.findOneAndUpdate.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(updated) }),
      });

      const result = await service.update('portfolio-1', { name: 'Renamed' }, 'user-1');

      expect(portfolioModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: 'portfolio-1', userId: 'user-1' },
        { $set: { name: 'Renamed' } },
        { new: true },
      );
      expect(result.name).toBe('Renamed');
    });

    it('throws NotFoundException when the portfolio is not found', async () => {
      portfolioModel.findOneAndUpdate.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(null) }),
      });
      await expect(service.update('missing', { name: 'X' }, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('deletes the portfolio', async () => {
      portfolioModel.findOneAndDelete.mockReturnValue({
        exec: () => Promise.resolve(mockPortfolioDoc),
      });
      await service.remove('portfolio-1', 'user-1');
      expect(portfolioModel.findOneAndDelete).toHaveBeenCalledWith({
        _id: 'portfolio-1',
        userId: 'user-1',
      });
    });

    it('throws NotFoundException when the portfolio is not found', async () => {
      portfolioModel.findOneAndDelete.mockReturnValue({ exec: () => Promise.resolve(null) });
      await expect(service.remove('missing', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('addStock', () => {
    it('adds a new holding, records a trade, and emits stock_added event', async () => {
      const docMock = {
        ...mockPortfolioDoc,
        stocks: [] as Array<{ symbol: string; shares: number; avgCostBasis: number }>,
        save: jest.fn().mockResolvedValue({
          toObject: () => ({
            ...mockPortfolioDoc,
            stocks: [{ symbol: 'AAPL', shares: 10, avgCostBasis: 150 }],
          }),
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

    it('averages cost basis when the symbol already exists in the portfolio', async () => {
      const existing = { symbol: 'AAPL', shares: 10, avgCostBasis: 100 };
      const docMock = {
        ...mockPortfolioDoc,
        userId: 'user-1',
        stocks: [existing],
        save: jest.fn().mockResolvedValue({
          toObject: () => ({
            ...mockPortfolioDoc,
            stocks: [{ symbol: 'AAPL', shares: 20, avgCostBasis: 110 }],
          }),
        }),
      };
      portfolioModel.findById.mockReturnValue({ exec: () => Promise.resolve(docMock) });

      await service.addStock('portfolio-1', { symbol: 'AAPL', shares: 10, price: 120 }, mockUser);

      // (10*100 + 10*120) / 20 = 110
      expect(existing.shares).toBe(20);
      expect(existing.avgCostBasis).toBe(110);
    });

    it('throws ForbiddenException when the portfolio belongs to another user', async () => {
      const docMock = { ...mockPortfolioDoc, userId: 'other-user', stocks: [] };
      portfolioModel.findById.mockReturnValue({ exec: () => Promise.resolve(docMock) });

      await expect(
        service.addStock('portfolio-1', { symbol: 'AAPL', shares: 5, price: 150 }, mockUser),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
