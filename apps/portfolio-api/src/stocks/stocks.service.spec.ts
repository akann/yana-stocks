import { HttpService } from '@nestjs/axios';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import type { AxiosResponse } from 'axios';
import type { OHLCV } from '@yana-stocks/shared-types';
import { RedisService } from '../redis/redis.service';
import type { AssetEntry, PriceCacheEntry } from './price-cache.types';
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
  let configService: jest.Mocked<ConfigService>;

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
            get: jest.fn().mockReturnValue(''),
          },
        },
      ],
    }).compile();

    service = module.get<StocksService>(StocksService);
    redis = module.get(RedisService);
    httpService = module.get(HttpService);
    configService = module.get(ConfigService);
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

    it('falls back to price-processor HTTP when Redis has no price and caches the response', async () => {
      redis.get.mockResolvedValue(null);
      httpService.get.mockReturnValue(
        of({ data: mockPriceCacheEntry } as AxiosResponse<PriceCacheEntry>),
      );

      const result = await service.getStock('AAPL');

      expect(result.price).toBe(180);
      expect(httpService.get).toHaveBeenCalledWith(
        expect.stringContaining('/prices/AAPL/quote'),
      );
      expect(redis.set).toHaveBeenCalledWith(
        'papi:price:AAPL',
        JSON.stringify(mockPriceCacheEntry),
        900,
      );
    });

    it('returns null price when HTTP fallback also fails', async () => {
      redis.get.mockResolvedValue(null);
      httpService.get.mockReturnValue(throwError(() => new Error('service unavailable')));

      const result = await service.getStock('AAPL');

      expect(result.price).toBeNull();
    });
  });

  describe('getHistory', () => {
    it('returns cached OHLCV data from Redis', async () => {
      const mockBars: OHLCV[] = [
        {
          symbol: 'AAPL',
          timestamp: new Date(),
          open: 170,
          high: 182,
          low: 169,
          close: 180,
          volume: 500000,
          interval: '1m',
        },
      ];
      redis.get.mockResolvedValue(JSON.stringify(mockBars));

      const result = await service.getHistory('AAPL');

      expect(result).toHaveLength(1);
      expect(httpService.get).not.toHaveBeenCalled();
    });

    it('fetches from price-processor when cache is cold and caches the result', async () => {
      const mockBars: OHLCV[] = [
        {
          symbol: 'AAPL',
          timestamp: new Date(),
          open: 170,
          high: 182,
          low: 169,
          close: 180,
          volume: 500000,
          interval: '1m',
        },
      ];
      redis.get.mockResolvedValue(null);
      httpService.get.mockReturnValue(of({ data: mockBars } as AxiosResponse<OHLCV[]>));

      const result = await service.getHistory('AAPL');

      expect(result).toHaveLength(1);
      expect(redis.set).toHaveBeenCalledWith('papi:history:AAPL:100:1m', expect.any(String), 30);
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
      const cachedMovers = {
        gainers: [{ symbol: 'AAPL', price: 180, change: 5, changePercent: 2.8, volume: 1000000 }],
        losers: [],
      };
      redis.get.mockResolvedValue(JSON.stringify(cachedMovers));

      const result = await service.getMovers();

      expect(result.gainers[0]?.symbol).toBe('AAPL');
      expect(redis.scan).not.toHaveBeenCalled();
    });

    it('builds gainers and losers from scan/mget when cache is cold', async () => {
      const entries: PriceCacheEntry[] = [
        { price: 200, prevPrice: 190, change: 10, changePercent: 5.26, volume: 1_000_000, timestamp: 't' },
        { price: 100, prevPrice: 110, change: -10, changePercent: -9.09, volume: 500_000, timestamp: 't' },
        { price: 150, prevPrice: 148, change: 2, changePercent: 1.35, volume: 750_000, timestamp: 't' },
      ];
      const keys = ['papi:price:AAPL', 'papi:price:TSLA', 'papi:price:MSFT'];

      redis.get.mockResolvedValue(null);
      redis.scan.mockResolvedValue(keys);
      redis.mget.mockResolvedValue(entries.map((e) => JSON.stringify(e)));

      const result = await service.getMovers(2);

      expect(result.gainers[0]?.symbol).toBe('AAPL');
      expect(result.losers[0]?.symbol).toBe('TSLA');
      expect(redis.set).toHaveBeenCalledWith('papi:movers', expect.any(String), 10);
    });
  });

  describe('getAssets', () => {
    const mockAlpacaAssets: AssetEntry[] = [
      { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', tradable: true },
      { symbol: 'MSFT', name: 'Microsoft Corporation', exchange: 'NASDAQ', tradable: true },
      { symbol: 'JPM', name: 'JPMorgan Chase & Co.', exchange: 'NYSE', tradable: true },
    ];

    it('returns from Redis cache when present', async () => {
      redis.get.mockResolvedValue(JSON.stringify(mockAlpacaAssets));

      const result = await service.getAssets('', 1, 10);

      expect(result.data).toHaveLength(3);
      expect(result.total).toBe(3);
      expect(httpService.get).not.toHaveBeenCalled();
    });

    it('falls back to MOCK_ASSETS and caches when no Alpaca credentials are set', async () => {
      redis.get.mockResolvedValue(null);
      (configService.get as jest.Mock).mockReturnValue('');

      const result = await service.getAssets('', 1, 10);

      expect(result.total).toBeGreaterThan(0);
      expect(redis.set).toHaveBeenCalledWith('papi:assets:all', expect.any(String), 86400);
      expect(httpService.get).not.toHaveBeenCalled();
    });

    it('fetches from Alpaca when credentials are set and caches the result', async () => {
      redis.get.mockResolvedValue(null);
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'alpaca.apiKey') return 'MY_KEY';
        if (key === 'alpaca.apiSecret') return 'MY_SECRET';
        return '';
      });
      httpService.get.mockReturnValue(
        of({
          data: mockAlpacaAssets.map((a) => ({ ...a })),
        } as AxiosResponse<AssetEntry[]>),
      );

      const result = await service.getAssets('', 1, 10);

      expect(httpService.get).toHaveBeenCalledWith(
        expect.stringContaining('alpaca.markets'),
        expect.objectContaining({
          headers: expect.objectContaining({ 'APCA-API-KEY-ID': 'MY_KEY' }) as unknown,
        }),
      );
      expect(result.data).toHaveLength(3);
      expect(redis.set).toHaveBeenCalledWith('papi:assets:all', expect.any(String), 86400);
    });

    it('falls back to MOCK_ASSETS when Alpaca request fails', async () => {
      redis.get.mockResolvedValue(null);
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'alpaca.apiKey') return 'MY_KEY';
        if (key === 'alpaca.apiSecret') return 'MY_SECRET';
        return '';
      });
      httpService.get.mockReturnValue(throwError(() => new Error('alpaca down')));

      const result = await service.getAssets('', 1, 10);

      expect(result.total).toBeGreaterThan(0);
    });

    it('filters by symbol prefix (case-insensitive)', async () => {
      redis.get.mockResolvedValue(JSON.stringify(mockAlpacaAssets));

      const result = await service.getAssets('aa', 1, 10);

      expect(result.data.every((a) => a.symbol.includes('AA'))).toBe(true);
      expect(result.total).toBe(1);
    });

    it('filters by name substring (case-insensitive)', async () => {
      redis.get.mockResolvedValue(JSON.stringify(mockAlpacaAssets));

      const result = await service.getAssets('microsoft', 1, 10);

      expect(result.data[0]?.symbol).toBe('MSFT');
      expect(result.total).toBe(1);
    });

    it('paginates results correctly', async () => {
      redis.get.mockResolvedValue(JSON.stringify(mockAlpacaAssets));

      const page1 = await service.getAssets('', 1, 2);
      const page2 = await service.getAssets('', 2, 2);

      expect(page1.data).toHaveLength(2);
      expect(page1.page).toBe(1);
      expect(page2.data).toHaveLength(1);
      expect(page2.total).toBe(3);
    });
  });
});
