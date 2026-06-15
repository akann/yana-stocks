import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type {
  ProcessedPriceMessage,
  PredictionSignal,
  SentimentSignal,
} from '@yana-stocks/shared-types';
import { RedisService } from '../redis/redis.service';
import { KafkaConsumerService } from './kafka-consumer.service';

// Prevent the Kafka client from actually connecting during tests.
jest.mock('kafkajs', () => {
  const eachMessageHandler: { fn?: (args: unknown) => Promise<void> } = {};
  const mockConsumer = {
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn().mockResolvedValue(undefined),
    run: jest
      .fn()
      .mockImplementation(({ eachMessage }: { eachMessage: (args: unknown) => Promise<void> }) => {
        eachMessageHandler.fn = eachMessage;
        return Promise.resolve();
      }),
    disconnect: jest.fn().mockResolvedValue(undefined),
    events: { CRASH: 'consumer.crash' },
  };
  return {
    Kafka: jest
      .fn()
      .mockImplementation(() => ({ consumer: jest.fn().mockReturnValue(mockConsumer) })),
    eachMessageHandler,
  };
});

type HandlePrice = (msg: ProcessedPriceMessage) => Promise<void>;
type HandleSentiment = (msg: SentimentSignal) => Promise<void>;
type HandlePrediction = (msg: PredictionSignal) => Promise<void>;

describe('KafkaConsumerService — message handlers', () => {
  let service: KafkaConsumerService;
  let redis: jest.Mocked<RedisService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KafkaConsumerService,
        {
          provide: RedisService,
          useValue: {
            get: jest.fn(),
            set: jest.fn().mockResolvedValue(undefined),
            del: jest.fn().mockResolvedValue(undefined),
          } satisfies Partial<RedisService>,
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockReturnValue(['localhost:9092']),
          },
        },
      ],
    }).compile();

    service = module.get<KafkaConsumerService>(KafkaConsumerService);
    redis = module.get(RedisService);
  });

  // Access private handlers via type assertion — tested in isolation here
  // because the Kafka consumer lifecycle (connect/subscribe/run) is an
  // integration concern; these handlers contain the real business logic.
  function handlePrice(msg: ProcessedPriceMessage): Promise<void> {
    return (service as unknown as { handlePrice: HandlePrice }).handlePrice(msg);
  }

  function handleSentiment(msg: SentimentSignal): Promise<void> {
    return (service as unknown as { handleSentiment: HandleSentiment }).handleSentiment(msg);
  }

  function handlePrediction(msg: PredictionSignal): Promise<void> {
    return (service as unknown as { handlePrediction: HandlePrediction }).handlePrediction(msg);
  }

  const baseMsg: ProcessedPriceMessage = {
    symbol: 'AAPL',
    price: 182,
    ohlcv: { open: 178, high: 183, low: 177, close: 182, volume: 1_200_000 },
    timestamp: '2024-01-01T15:00:00Z',
  };

  describe('handlePrice', () => {
    it('writes price entry to papi:price:<symbol> with 24h TTL', async () => {
      redis.get.mockResolvedValue(null);

      await handlePrice(baseMsg);

      expect(redis.set).toHaveBeenCalledWith('papi:price:AAPL', expect.any(String), 86400);
    });

    it('computes change and changePercent against the previous cached price', async () => {
      const prev = JSON.stringify({
        price: 175,
        prevPrice: 170,
        change: 5,
        changePercent: 2.94,
        volume: 1_000_000,
        timestamp: 't',
      });
      redis.get.mockResolvedValue(prev);

      await handlePrice(baseMsg);

      const written = JSON.parse((redis.set.mock.calls[0] as [string, string, number])[1]) as {
        price: number;
        prevPrice: number;
        change: number;
        changePercent: number;
      };
      expect(written.price).toBe(182);
      expect(written.prevPrice).toBe(175);
      expect(written.change).toBeCloseTo(7, 5);
      expect(written.changePercent).toBeCloseTo((7 / 175) * 100, 5);
    });

    it('uses current price as prevPrice when no previous entry exists', async () => {
      redis.get.mockResolvedValue(null);

      await handlePrice(baseMsg);

      const written = JSON.parse((redis.set.mock.calls[0] as [string, string, number])[1]) as {
        change: number;
      };
      expect(written.change).toBe(0);
    });

    it('invalidates the movers cache', async () => {
      redis.get.mockResolvedValue(null);

      await handlePrice(baseMsg);

      expect(redis.del).toHaveBeenCalledWith('papi:movers');
    });
  });

  describe('handleSentiment', () => {
    const sentimentMsg: SentimentSignal = {
      symbol: 'AAPL',
      label: 'positive',
      score: 0.87,
      source: 'reuters',
      headline: 'Apple beats expectations',
      publishedAt: new Date('2024-01-01T08:00:00Z'),
      analyzedAt: new Date('2024-01-01T09:00:00Z'),
    };

    it('stores sentiment in Redis under papi:sentiment:<symbol> with 48h TTL', async () => {
      await handleSentiment(sentimentMsg);

      expect(redis.set).toHaveBeenCalledWith(
        'papi:sentiment:AAPL',
        JSON.stringify(sentimentMsg),
        172800,
      );
    });
  });

  describe('handlePrediction', () => {
    const predictionMsg: PredictionSignal = {
      symbol: 'AAPL',
      currentPrice: 182,
      predictedPrice: 190,
      confidence: 0.78,
      horizon: '1d',
      model: 'prophet',
      generatedAt: new Date('2024-01-01T12:00:00Z'),
    };

    it('stores prediction in Redis under papi:prediction:<symbol> with 48h TTL', async () => {
      await handlePrediction(predictionMsg);

      expect(redis.set).toHaveBeenCalledWith(
        'papi:prediction:AAPL',
        JSON.stringify(predictionMsg),
        172800,
      );
    });
  });
});
