import { HttpService } from '@nestjs/axios';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import type { AxiosResponse } from 'axios';
import type { OHLCV } from '@yana-stocks/shared-types';
import { RedisService } from '../redis/redis.service';
import type { PriceCacheEntry } from './price-cache.types';
import { StocksService } from './stocks.service';

const mockPriceCacheEntry: PriceCacheEntry = {
  price: 180,
  prevPrice: 175,
  change: 5,
  changePercent: 2.857,
  volume: 1000000,
  timestamp: '2024-01-01T12:00:00Z',
};

describe('StocksService', () => {
  let service: StocksService;
  let redis: jest.Mocked<RedisService>;
  let httpService: jest.Mocked<HttpService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StocksService,
        {
          provide: RedisService,
          useValue: {
            get: jest.fn(),
            set: jest.fn().mockResolvedValue(undefined),
            scan: jest.fn().mockResolvedValue([]),
            mget: jest.fn().mockResolvedValue([]),
          } satisfies Partial<RedisService>,
        },
        {
          provide: HttpService,
          useValue: {
            get: jest.fn(),
          } satisfies Partial<HttpService>,
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockReturnValue('http://price-processor:3000'),
          },
        },
      ],
    }).compile();

    service = module.get<StocksService>(StocksService);
    redis = module.get(RedisService);
    httpService = module.get(HttpService);
  });

  describe('getStock', () => {
    it('returns null fields when no Redis data is available', async () => {
      redis.get.mockResolvedValue(null);

      const result = await service.getStock('AAPL');

      expect(result.symbol).toBe('AAPL');
      expect(result.price).toBeNull();
      expect(result.sentiment).toBeNull();
      expect(result.prediction).toBeNull();
    });

    it('returns price data from Redis', async () => {
      redis.get.mockImplementation((key: string) => {
        if (key === 'papi:price:AAPL') return Promise.resolve(JSON.stringify(mockPriceCacheEntry));
        return Promise.resolve(null);
      });

      const result = await service.getStock('AAPL');

      expect(result.price).toBe(180);
      expect(result.change).toBe(5);
      expect(result.sentiment).toBeNull();
    });
  });

  describe('getHistory', () => {
    it('returns cached OHLCV data from Redis', async () => {
      const mockBars: OHLCV[] = [
        { symbol: 'AAPL', timestamp: new Date(), open: 170, high: 182, low: 169, close: 180, volume: 500000, interval: '1m' },
      ];
      redis.get.mockResolvedValue(JSON.stringify(mockBars));

      const result = await service.getHistory('AAPL');

      expect(result).toHaveLength(1);
      expect(httpService.get).not.toHaveBeenCalled();
    });

    it('fetches from price-processor when cache is cold and caches the result', async () => {
      const mockBars: OHLCV[] = [
        { symbol: 'AAPL', timestamp: new Date(), open: 170, high: 182, low: 169, close: 180, volume: 500000, interval: '1m' },
      ];
      redis.get.mockResolvedValue(null);
      httpService.get.mockReturnValue(
        of({ data: mockBars } as AxiosResponse<OHLCV[]>),
      );

      const result = await service.getHistory('AAPL');

      expect(result).toHaveLength(1);
      expect(redis.set).toHaveBeenCalledWith(
        'papi:history:AAPL:100',
        expect.any(String),
        30,
      );
    });
  });

  describe('getMovers', () => {
    it('returns empty movers when no prices in Redis', async () => {
      redis.get.mockResolvedValue(null);
      redis.scan.mockResolvedValue([]);

      const result = await service.getMovers();

      expect(result.gainers).toHaveLength(0);
      expect(result.losers).toHaveLength(0);
    });

    it('returns cached movers when available', async () => {
      const cachedMovers = { gainers: [{ symbol: 'AAPL', price: 180, change: 5, changePercent: 2.8, volume: 1000000 }], losers: [] };
      redis.get.mockResolvedValue(JSON.stringify(cachedMovers));

      const result = await service.getMovers();

      expect(result.gainers[0]?.symbol).toBe('AAPL');
      expect(redis.scan).not.toHaveBeenCalled();
    });
  });
});
