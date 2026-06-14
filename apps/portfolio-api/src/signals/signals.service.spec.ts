import { Test, TestingModule } from '@nestjs/testing';
import type { PredictionSignal, SentimentSignal } from '@yana-stocks/shared-types';
import { RedisService } from '../redis/redis.service';
import { SignalsService } from './signals.service';

const mockSentiment: SentimentSignal = {
  symbol: 'AAPL',
  label: 'positive',
  score: 0.85,
  source: 'reuters',
  headline: 'Apple reports record earnings',
  publishedAt: new Date('2024-01-01T09:00:00Z'),
  analyzedAt: new Date('2024-01-01T10:00:00Z'),
};

const mockPrediction: PredictionSignal = {
  symbol: 'AAPL',
  currentPrice: 175,
  predictedPrice: 182,
  confidence: 0.72,
  horizon: '1d',
  model: 'lstm-v2',
  generatedAt: new Date('2024-01-01T10:00:00Z'),
};

describe('SignalsService', () => {
  let service: SignalsService;
  let redis: jest.Mocked<RedisService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignalsService,
        {
          provide: RedisService,
          useValue: {
            get: jest.fn(),
          } satisfies Partial<RedisService>,
        },
      ],
    }).compile();

    service = module.get(SignalsService);
    redis = module.get(RedisService);
  });

  describe('getSignals', () => {
    it('returns null for both signals when the cache is empty', async () => {
      redis.get.mockResolvedValue(null);

      const result = await service.getSignals('AAPL');

      expect(result.symbol).toBe('AAPL');
      expect(result.sentiment).toBeNull();
      expect(result.prediction).toBeNull();
    });

    it('returns parsed sentiment and prediction when both are cached', async () => {
      redis.get.mockImplementation((key: string) => {
        if (key === 'papi:sentiment:AAPL') return Promise.resolve(JSON.stringify(mockSentiment));
        if (key === 'papi:prediction:AAPL') return Promise.resolve(JSON.stringify(mockPrediction));
        return Promise.resolve(null);
      });

      const result = await service.getSignals('AAPL');

      // JSON.parse returns date fields as ISO strings, not Date objects
      expect(result.sentiment).toEqual(
        expect.objectContaining({ symbol: 'AAPL', label: 'positive', score: 0.85 }),
      );
      expect(result.prediction).toEqual(
        expect.objectContaining({ symbol: 'AAPL', confidence: 0.72, horizon: '1d' }),
      );
    });

    it('returns sentiment but null prediction when only sentiment is cached', async () => {
      redis.get.mockImplementation((key: string) => {
        if (key === 'papi:sentiment:AAPL') return Promise.resolve(JSON.stringify(mockSentiment));
        return Promise.resolve(null);
      });

      const result = await service.getSignals('AAPL');

      expect(result.sentiment).toEqual(
        expect.objectContaining({ symbol: 'AAPL', label: 'positive' }),
      );
      expect(result.prediction).toBeNull();
    });

    it('reads from the correct Redis keys', async () => {
      redis.get.mockResolvedValue(null);

      await service.getSignals('TSLA');

      expect(redis.get).toHaveBeenCalledWith('papi:sentiment:TSLA');
      expect(redis.get).toHaveBeenCalledWith('papi:prediction:TSLA');
    });
  });
});
