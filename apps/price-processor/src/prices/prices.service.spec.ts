import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import type { ProcessedPriceMessage, RawPriceMessage } from '@yana-stocks/shared-types';
import { KAFKA_TOPICS } from '@yana-stocks/kafka-client';
import { RedisService } from '../redis/redis.service';
import { KafkaProducerService } from './kafka-producer.service';
import { PricesService } from './prices.service';
import { PriceBar } from './schemas/price-bar.schema';

const mockBar: PriceBar = {
  symbol: 'AAPL',
  timestamp: new Date('2024-01-01T10:30:00.000Z'),
  open: 150.0,
  high: 151.5,
  low: 149.5,
  close: 151.0,
  volume: 1500,
};

const rawMsg: RawPriceMessage = {
  symbol: 'AAPL',
  price: 151.0,
  bid: 150.9,
  ask: 151.1,
  volume: 500,
  timestamp: '2024-01-01T10:30:45.000Z',
};

describe('PricesService', () => {
  let service: PricesService;
  let mockModel: { findOneAndUpdate: jest.Mock };
  let redis: jest.Mocked<RedisService>;
  let producer: jest.Mocked<KafkaProducerService>;

  beforeEach(async () => {
    mockModel = {
      findOneAndUpdate: jest.fn().mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(mockBar) }),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PricesService,
        { provide: getModelToken(PriceBar.name), useValue: mockModel },
        {
          provide: RedisService,
          useValue: {
            setex: jest.fn().mockResolvedValue(undefined),
          } satisfies Partial<RedisService>,
        },
        {
          provide: KafkaProducerService,
          useValue: {
            emit: jest.fn().mockResolvedValue(undefined),
          } satisfies Partial<KafkaProducerService>,
        },
      ],
    }).compile();

    service = module.get<PricesService>(PricesService);
    redis = module.get(RedisService);
    producer = module.get(KafkaProducerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('process', () => {
    it('upserts the minute bar with correct operators', async () => {
      await service.process(rawMsg);

      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ symbol: 'AAPL' }),
        expect.objectContaining({
          $setOnInsert: expect.objectContaining({ open: 151.0 }) as unknown,
          $max: { high: 151.0 },
          $min: { low: 151.0 },
          $set: { close: 151.0 },
          $inc: { volume: 500 },
        }),
        { upsert: true, new: true },
      );
    });

    it('caches the latest price in Redis with 5s TTL', async () => {
      await service.process(rawMsg);

      expect(redis.setex).toHaveBeenCalledWith('price:latest:AAPL', 5, '151');
    });

    it('emits ProcessedPriceMessage to the processed topic', async () => {
      await service.process(rawMsg);

      expect(producer.emit).toHaveBeenCalledWith(
        KAFKA_TOPICS.PRICES_PROCESSED,
        'AAPL',
        expect.objectContaining<Partial<ProcessedPriceMessage>>({
          symbol: 'AAPL',
          price: 151.0,
          ohlcv: expect.objectContaining({
            open: 150.0,
            close: 151.0,
          }) as ProcessedPriceMessage['ohlcv'],
        }),
      );
    });

    it('truncates the timestamp to the current minute', async () => {
      await service.process(rawMsg);

      const [query] = mockModel.findOneAndUpdate.mock.calls[0] as [{ timestamp: Date }];
      expect(query.timestamp.getSeconds()).toBe(0);
      expect(query.timestamp.getMilliseconds()).toBe(0);
    });
  });
});
