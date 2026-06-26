import { HttpService } from '@nestjs/axios';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import type { AxiosResponse } from 'axios';
import type { OHLCV } from '@yana-stocks/shared-types';
import { RedisService } from '../redis/redis.service';
import type { AssetEntry, PriceCacheEntry, ScreenerResult } from './price-cache.types';
import { StocksService } from './stocks.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBar(close: number): OHLCV {
  return {
    symbol: 'TEST',
    timestamp: new Date(),
    open: close,
    high: close,
    low: close,
    close,
    volume: 1_000_000,
    interval: '1d',
  };
}

/** Build N bars where the first bar has `startClose` and each subsequent bar
 *  increases by `step`. Matches the price-processor history response order
 *  (oldest → newest). */
function makeBars(count: number, startClose = 100, step = 0): OHLCV[] {
  return Array.from({ length: count }, (_, i) => makeBar(startClose + i * step));
}

const mockPriceCacheEntry: PriceCacheEntry = {
  price: 180,
  prevPrice: 175,
  change: 5,
  changePercent: 2.857,
  volume: 1000000,
  timestamp: '2024-01-01T12:00:00Z',
};

const mockEquityAssets: AssetEntry[] = [
  {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    exchange: 'NASDAQ',
    tradable: true,
    assetClass: 'us_equity',
  },
  {
    symbol: 'MSFT',
    name: 'Microsoft Corporation',
    exchange: 'NASDAQ',
    tradable: true,
    assetClass: 'us_equity',
  },
  {
    symbol: 'JPM',
    name: 'JPMorgan Chase & Co.',
    exchange: 'NYSE',
    tradable: true,
    assetClass: 'us_equity',
  },
];

const mockEtfAssets: AssetEntry[] = [
  {
    symbol: 'SPY',
    name: 'SPDR S&P 500 ETF Trust',
    exchange: 'NYSE ARCA',
    tradable: true,
    assetClass: 'us_etf',
  },
  {
    symbol: 'QQQ',
    name: 'Invesco QQQ Trust',
    exchange: 'NASDAQ',
    tradable: true,
    assetClass: 'us_etf',
  },
];

const mockGlobalAssets: AssetEntry[] = [
  {
    symbol: 'ASML',
    name: 'ASML Holding N.V.',
    exchange: 'NASDAQ',
    tradable: true,
    assetClass: 'intl_equity',
  },
  {
    symbol: 'NVO',
    name: 'Novo Nordisk A/S',
    exchange: 'NYSE',
    tradable: true,
    assetClass: 'intl_equity',
  },
  {
    symbol: 'TSM',
    name: 'Taiwan Semiconductor Manufacturing',
    exchange: 'NYSE',
    tradable: true,
    assetClass: 'intl_equity',
  },
];

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
        expect.objectContaining({ timeout: 3000 }),
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
        {
          price: 200,
          prevPrice: 190,
          change: 10,
          changePercent: 5.26,
          volume: 1_000_000,
          timestamp: 't',
        },
        {
          price: 100,
          prevPrice: 110,
          change: -10,
          changePercent: -9.09,
          volume: 500_000,
          timestamp: 't',
        },
        {
          price: 150,
          prevPrice: 148,
          change: 2,
          changePercent: 1.35,
          volume: 750_000,
          timestamp: 't',
        },
      ];
      const keys = ['papi:price:AAPL', 'papi:price:TSLA', 'papi:price:MSFT'];

      redis.get.mockResolvedValue(null);
      redis.scan.mockResolvedValue(keys);
      redis.mget
        .mockResolvedValueOnce(new Array(15).fill(null))
        .mockResolvedValueOnce(entries.map((e) => JSON.stringify(e)));

      const result = await service.getMovers(2);

      expect(result.gainers[0]?.symbol).toBe('AAPL');
      expect(result.losers[0]?.symbol).toBe('TSLA');
      expect(redis.set).toHaveBeenCalledWith('papi:movers', expect.any(String), 10);
    });

    describe('DEFAULT_SYMBOLS seeding', () => {
      it('fetches all 15 DEFAULT_SYMBOLS when none are in the cache', async () => {
        redis.get.mockResolvedValue(null);
        redis.mget.mockResolvedValueOnce(new Array(15).fill(null)).mockResolvedValueOnce([]);
        redis.scan.mockResolvedValue([]);
        httpService.get.mockReturnValue(
          of({ data: mockPriceCacheEntry } as AxiosResponse<PriceCacheEntry>),
        );

        await service.getMovers();

        expect(httpService.get).toHaveBeenCalledTimes(15);
      });

      it('skips fetching when all DEFAULT_SYMBOLS are already cached', async () => {
        redis.get.mockResolvedValue(null);
        redis.mget
          .mockResolvedValueOnce(new Array(15).fill(JSON.stringify(mockPriceCacheEntry)))
          .mockResolvedValueOnce([]);
        redis.scan.mockResolvedValue([]);

        await service.getMovers();

        expect(httpService.get).not.toHaveBeenCalled();
      });

      it('only fetches symbols absent from the cache (partial hit)', async () => {
        redis.get.mockResolvedValue(null);
        const partialHit = new Array(15).fill(null);
        partialHit[0] = JSON.stringify(mockPriceCacheEntry);
        partialHit[1] = JSON.stringify(mockPriceCacheEntry);
        partialHit[2] = JSON.stringify(mockPriceCacheEntry);
        redis.mget.mockResolvedValueOnce(partialHit).mockResolvedValueOnce([]);
        redis.scan.mockResolvedValue([]);
        httpService.get.mockReturnValue(
          of({ data: mockPriceCacheEntry } as AxiosResponse<PriceCacheEntry>),
        );

        await service.getMovers();

        expect(httpService.get).toHaveBeenCalledTimes(12);
      });

      it('still returns movers when DEFAULT_SYMBOLS fetches fail (Promise.allSettled)', async () => {
        redis.get.mockResolvedValue(null);
        redis.mget
          .mockResolvedValueOnce(new Array(15).fill(null))
          .mockResolvedValueOnce([JSON.stringify(mockPriceCacheEntry)]);
        redis.scan.mockResolvedValue(['papi:price:AAPL']);
        httpService.get.mockReturnValue(throwError(() => new Error('service down')));

        const result = await service.getMovers();

        expect(result.gainers).toBeDefined();
        expect(result.losers).toBeDefined();
        expect(result.gainers[0]?.symbol).toBe('AAPL');
      });
    });
  });

  describe('getMovers FMP fallback', () => {
    it('falls back to FMP batch quotes when Redis has no price keys', async () => {
      redis.get.mockResolvedValue(null);
      redis.scan.mockResolvedValue([]);
      redis.mget.mockResolvedValue(new Array(15).fill(null));
      (configService.get as jest.Mock).mockReturnValue('FMP_KEY');

      const fmpQuotes = [
        { symbol: 'AAPL', price: 190, change: 3, changesPercentage: 1.6, volume: 60_000_000 },
        { symbol: 'MSFT', price: 410, change: -2, changesPercentage: -0.5, volume: 25_000_000 },
        { symbol: 'NVDA', price: 1080, change: 15, changesPercentage: 1.4, volume: 40_000_000 },
      ];

      httpService.get.mockImplementation((url: string) => {
        if (url.includes('financialmodelingprep')) {
          return of({ data: fmpQuotes } as AxiosResponse);
        }
        return throwError(() => new Error('price-processor down'));
      });

      const result = await service.getMovers(2);

      expect(result.gainers[0]?.symbol).toBe('AAPL');
      expect(result.losers[0]?.symbol).toBe('MSFT');
      expect(redis.set).toHaveBeenCalledWith('papi:movers', expect.any(String), 60);
    });
  });

  describe('getAssets', () => {
    it('returns from Redis cache when present (us market)', async () => {
      redis.get.mockResolvedValue(JSON.stringify(mockEquityAssets));

      const result = await service.getAssets('', 1, 10, 'us');

      expect(result.data).toHaveLength(3);
      expect(result.total).toBe(3);
      expect(result.data[0]?.assetClass).toBe('us_equity');
      expect(httpService.get).not.toHaveBeenCalled();
    });

    it('returns from Redis cache when present (etf market)', async () => {
      redis.get.mockResolvedValue(JSON.stringify(mockEtfAssets));

      const result = await service.getAssets('', 1, 10, 'etf');

      expect(result.data).toHaveLength(2);
      expect(result.data[0]?.assetClass).toBe('us_etf');
    });

    it('uses separate cache keys for us and etf markets', async () => {
      redis.get.mockResolvedValue(JSON.stringify(mockEquityAssets));

      await service.getAssets('', 1, 10, 'us');
      await service.getAssets('', 1, 10, 'etf');

      expect(redis.get).toHaveBeenCalledWith('papi:assets:us');
      expect(redis.get).toHaveBeenCalledWith('papi:assets:etf');
    });

    it('falls back to MOCK_ASSETS when no Massive API key is set and caches', async () => {
      redis.get.mockResolvedValue(null);
      (configService.get as jest.Mock).mockReturnValue('');

      const result = await service.getAssets('', 1, 10, 'us');

      expect(result.total).toBeGreaterThan(0);
      expect(result.data[0]?.assetClass).toBe('us_equity');
      expect(redis.set).toHaveBeenCalledWith('papi:assets:us', expect.any(String), 86400);
    });

    it('falls back to MOCK_ETF_ASSETS when no Massive API key is set for etf market', async () => {
      redis.get.mockResolvedValue(null);
      (configService.get as jest.Mock).mockReturnValue('');

      const result = await service.getAssets('', 1, 10, 'etf');

      expect(result.total).toBeGreaterThan(0);
      expect(result.data[0]?.assetClass).toBe('us_etf');
      expect(redis.set).toHaveBeenCalledWith('papi:assets:etf', expect.any(String), 86400);
    });

    it('fetches from Massive when API key is set and caches the result', async () => {
      redis.get.mockResolvedValue(null);
      (configService.get as jest.Mock).mockReturnValue('MY_MASSIVE_KEY');

      const massiveResults = [
        { ticker: 'AAPL', name: 'Apple Inc.', primary_exchange: 'NASDAQ', active: true },
        { ticker: 'MSFT', name: 'Microsoft Corporation', primary_exchange: 'NASDAQ', active: true },
      ];
      httpService.get.mockReturnValueOnce(
        of({ data: { results: massiveResults } } as AxiosResponse<{
          results: typeof massiveResults;
        }>),
      );

      const result = await service.getAssets('', 1, 10, 'us');

      expect(httpService.get).toHaveBeenCalledWith(
        'https://api.polygon.io/v3/reference/tickers',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        expect.objectContaining({ params: expect.objectContaining({ type: 'CS' }) }),
      );
      expect(result.data).toHaveLength(2);
      expect(result.data[0]?.symbol).toBe('AAPL');
      expect(result.data[0]?.assetClass).toBe('us_equity');
      expect(redis.set).toHaveBeenCalledWith('papi:assets:us', expect.any(String), 86400);
    });

    it('calls Massive with type=ETF when market=etf', async () => {
      redis.get.mockResolvedValue(null);
      (configService.get as jest.Mock).mockReturnValue('MY_MASSIVE_KEY');

      httpService.get.mockReturnValueOnce(
        of({ data: { results: [] } } as AxiosResponse<{ results: never[] }>),
      );

      await service.getAssets('', 1, 10, 'etf');

      expect(httpService.get).toHaveBeenCalledWith(
        'https://api.polygon.io/v3/reference/tickers',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        expect.objectContaining({ params: expect.objectContaining({ type: 'ETF' }) }),
      );
    });

    it('falls back to MOCK_ASSETS when Massive request fails', async () => {
      redis.get.mockResolvedValue(null);
      (configService.get as jest.Mock).mockReturnValue('MY_MASSIVE_KEY');

      httpService.get.mockReturnValueOnce(throwError(() => new Error('massive down')));

      const result = await service.getAssets('', 1, 10, 'us');

      expect(result.total).toBeGreaterThan(0);
      expect(result.data[0]?.assetClass).toBe('us_equity');
    });

    it('filters by symbol prefix (case-insensitive)', async () => {
      redis.get.mockResolvedValue(JSON.stringify(mockEquityAssets));

      const result = await service.getAssets('aa', 1, 10, 'us');

      expect(result.data.every((a) => a.symbol.includes('AA'))).toBe(true);
      expect(result.total).toBe(1);
    });

    it('filters by name substring (case-insensitive)', async () => {
      redis.get.mockResolvedValue(JSON.stringify(mockEquityAssets));

      const result = await service.getAssets('microsoft', 1, 10, 'us');

      expect(result.data[0]?.symbol).toBe('MSFT');
      expect(result.total).toBe(1);
    });

    it('paginates results correctly', async () => {
      redis.get.mockResolvedValue(JSON.stringify(mockEquityAssets));

      const page1 = await service.getAssets('', 1, 2, 'us');
      const page2 = await service.getAssets('', 2, 2, 'us');

      expect(page1.data).toHaveLength(2);
      expect(page1.page).toBe(1);
      expect(page2.data).toHaveLength(1);
      expect(page2.total).toBe(3);
    });

    it('returns from Redis cache when present (global market)', async () => {
      redis.get.mockResolvedValue(JSON.stringify(mockGlobalAssets));

      const result = await service.getAssets('', 1, 10, 'global');

      expect(result.data).toHaveLength(3);
      expect(result.data[0]?.assetClass).toBe('intl_equity');
      expect(httpService.get).not.toHaveBeenCalled();
    });

    it('uses separate cache key for global market', async () => {
      redis.get.mockResolvedValue(JSON.stringify(mockGlobalAssets));

      await service.getAssets('', 1, 10, 'global');

      expect(redis.get).toHaveBeenCalledWith('papi:assets:global');
    });

    it('returns MOCK_GLOBAL_ASSETS for global market without calling Massive', async () => {
      redis.get.mockResolvedValue(null);
      (configService.get as jest.Mock).mockReturnValue('MY_MASSIVE_KEY');

      const result = await service.getAssets('', 1, 10, 'global');

      expect(httpService.get).not.toHaveBeenCalled();
      expect(result.total).toBeGreaterThan(0);
      expect(result.data.every((a) => a.assetClass === 'intl_equity')).toBe(true);
      expect(redis.set).toHaveBeenCalledWith('papi:assets:global', expect.any(String), 86400);
    });
  });

  describe('getOverview', () => {
    const fmpIndices = [
      { symbol: '^GSPC', name: 'S&P 500', price: 5200, change: 26, changePercentage: 0.5 },
      { symbol: '^IXIC', name: 'Nasdaq', price: 18000, change: -50, changePercentage: -0.27 },
    ];
    const fmpNews = [
      {
        title: 'Markets rally on Fed optimism',
        url: 'https://example.com/1',
        publishedDate: '2026-01-01T10:00:00.000Z',
        site: 'Reuters',
        text: 'Lorem ipsum dolor sit amet.',
      },
    ];

    const mockOverviewHttp = (opts: { indexFail?: boolean } = {}) => {
      httpService.get.mockImplementation(
        (url: string, config?: { params?: Record<string, unknown> }) => {
          const sym = config?.params?.['symbol'] as string | undefined;
          // FMP index quotes
          if (url.includes('/stable/quote')) {
            if (opts.indexFail && (sym === '^FTSE' || sym === '^GDAXI')) {
              return throwError(() => new Error('timeout'));
            }
            if (sym === '^GSPC') return of({ data: [fmpIndices[0]] } as AxiosResponse);
            if (sym === '^IXIC') return of({ data: [fmpIndices[1]] } as AxiosResponse);
            return of({ data: [] } as AxiosResponse);
          }
          // FMP news
          if (url.includes('/news/stock')) return of({ data: fmpNews } as AxiosResponse);
          // Polygon sector ETFs
          if (url.includes('polygon.io')) {
            return of({ data: { ticker: { todaysChangePerc: 1.5 } } } as AxiosResponse);
          }
          return throwError(() => new Error('unexpected url'));
        },
      );
    };

    it('returns indices, sectors, and news', async () => {
      redis.get.mockResolvedValue(null);
      (configService.get as jest.Mock).mockReturnValue('KEY');
      mockOverviewHttp();

      const result = await service.getOverview();

      expect(result.indices).toHaveLength(2);
      expect(result.indices[0]?.symbol).toBe('^GSPC');
      expect(result.indices[0]?.name).toBe('S&P 500');
      expect(result.sectors).toHaveLength(11);
      expect(result.sectors[0]?.sector).toBe('Technology');
      expect(result.sectors[0]?.changesPercentage).toBeCloseTo(1.5);
      expect(result.news).toHaveLength(1);
      expect(result.news[0]?.title).toBe('Markets rally on Fed optimism');
      expect(redis.set).toHaveBeenCalledWith('papi:overview', expect.any(String), 300);
    });

    it('returns cached overview without hitting APIs', async () => {
      const cached = { indices: fmpIndices, sectors: [], news: [] };
      redis.get.mockResolvedValue(JSON.stringify(cached));

      const result = await service.getOverview();

      expect(httpService.get).not.toHaveBeenCalled();
      expect(result.indices).toHaveLength(2);
    });

    it('returns empty overview when no API keys are set', async () => {
      redis.get.mockResolvedValue(null);
      (configService.get as jest.Mock).mockReturnValue('');

      const result = await service.getOverview();

      expect(httpService.get).not.toHaveBeenCalled();
      expect(result.indices).toHaveLength(0);
      expect(result.sectors).toHaveLength(0);
      expect(result.news).toHaveLength(0);
    });

    it('returns partial indices when some FMP index calls fail', async () => {
      redis.get.mockResolvedValue(null);
      (configService.get as jest.Mock).mockReturnValue('KEY');
      mockOverviewHttp({ indexFail: true });

      const result = await service.getOverview();

      expect(result.indices).toHaveLength(2);
      expect(result.sectors).toHaveLength(11);
      expect(result.news).toHaveLength(1);
    });
  });

  describe('getScreener', () => {
    const aaplProfile = {
      symbol: 'AAPL',
      companyName: 'Apple Inc.',
      price: 195,
      change: 2.5,
      changePercentage: 1.3,
      marketCap: 3_000_000_000_000,
      sector: 'Technology',
      volume: 50_000_000,
      lastDividend: 0.97,
    };
    const msftProfile = {
      symbol: 'MSFT',
      companyName: 'Microsoft Corp',
      price: 410,
      change: -1.2,
      changePercentage: -0.3,
      marketCap: 3_100_000_000_000,
      sector: 'Technology',
      volume: 25_000_000,
      lastDividend: 3.0,
    };

    it('returns empty array when FMP_API_KEY is not set', async () => {
      redis.get.mockResolvedValue(null);
      (configService.get as jest.Mock).mockReturnValue('');

      const result = await service.getScreener({});

      expect(httpService.get).not.toHaveBeenCalled();
      expect(result).toHaveLength(0);
    });

    it('returns cached results without hitting FMP', async () => {
      const cached: ScreenerResult[] = [
        {
          symbol: 'AAPL',
          name: 'Apple Inc.',
          price: 195,
          change: 2.5,
          changesPercentage: 1.3,
          marketCap: 3_000_000_000_000,
          sector: 'Technology',
          volume: 50_000_000,
          dividendYield: 0.5,
        },
      ];
      redis.get.mockResolvedValue(JSON.stringify(cached));

      const result = await service.getScreener({});

      expect(httpService.get).not.toHaveBeenCalled();
      expect(result[0]?.symbol).toBe('AAPL');
    });

    it('fetches profiles from FMP stable API, applies filters, and caches', async () => {
      redis.get.mockResolvedValue(null);
      (configService.get as jest.Mock).mockReturnValue('FMP_KEY');

      // First two calls return AAPL and MSFT profiles; remaining SCREENER_SYMBOLS return []
      httpService.get
        .mockReturnValueOnce(of({ data: [aaplProfile] } as AxiosResponse))
        .mockReturnValueOnce(of({ data: [msftProfile] } as AxiosResponse))
        .mockReturnValue(of({ data: [] } as AxiosResponse));

      const result = await service.getScreener({ limit: 25 });

      expect(result.length).toBeGreaterThanOrEqual(2);
      // sorted by marketCap descending — MSFT (3.1T) > AAPL (3T)
      expect(result[0]?.symbol).toBe('MSFT');
      expect(result[0]?.changesPercentage).toBeCloseTo(-0.3);
      expect(result[1]?.symbol).toBe('AAPL');
      expect(result[1]?.changesPercentage).toBeCloseTo(1.3);
      expect(redis.set).toHaveBeenCalledWith('papi:screener:profiles', expect.any(String), 3600);
    });

    it('applies changeMin filter on cached results without extra API calls', async () => {
      const cached: ScreenerResult[] = [
        {
          symbol: 'AAPL',
          name: 'Apple Inc.',
          price: 195,
          change: 2.5,
          changesPercentage: 1.3,
          marketCap: 3e12,
          sector: 'Technology',
          volume: 50e6,
          dividendYield: 0.5,
        },
        {
          symbol: 'MSFT',
          name: 'Microsoft Corp',
          price: 410,
          change: -1.2,
          changesPercentage: -0.3,
          marketCap: 3.1e12,
          sector: 'Technology',
          volume: 25e6,
          dividendYield: 0.7,
        },
      ];
      redis.get.mockResolvedValue(JSON.stringify(cached));

      const result = await service.getScreener({ changeMin: 1 });

      expect(result).toHaveLength(1);
      expect(result[0]?.symbol).toBe('AAPL');
      expect(httpService.get).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // getSectorRotation
  // -------------------------------------------------------------------------
  describe('getSectorRotation', () => {
    // FMP returns newest-first; we provide two entries to exercise the reversal.
    const fmpResponse = [
      {
        date: '2024-01-12', // newest
        technology: 1.2,
        financialServices: 0.5,
        healthcare: -0.3,
        consumerCyclical: 0.8,
        industrials: 0.4,
        communicationServices: -0.1,
        consumerDefensive: 0.2,
        energy: 1.5,
        realEstate: -0.7,
        basicMaterials: 0.3,
        utilities: -0.4,
      },
      {
        date: '2024-01-05', // oldest
        technology: 0.8,
        financialServices: -0.3,
        healthcare: 0.5,
        consumerCyclical: 0.2,
        industrials: 0.9,
        communicationServices: 0.6,
        consumerDefensive: -0.1,
        energy: 0.7,
        realEstate: 0.3,
        basicMaterials: -0.2,
        utilities: 0.1,
      },
    ];

    it('returns cached data without calling FMP', async () => {
      const cached = { dates: ['2024-01-05'], rows: [{ sector: 'Technology', changes: [0.8] }] };
      redis.get.mockResolvedValue(JSON.stringify(cached));

      const result = await service.getSectorRotation('sp500');

      expect(httpService.get).not.toHaveBeenCalled();
      expect(result.dates).toHaveLength(1);
      expect(result.rows[0]?.sector).toBe('Technology');
    });

    it('returns empty data immediately for ftse100', async () => {
      redis.get.mockResolvedValue(null);

      const result = await service.getSectorRotation('ftse100');

      expect(httpService.get).not.toHaveBeenCalled();
      expect(result.dates).toHaveLength(0);
      expect(result.rows).toHaveLength(0);
    });

    it('returns empty data when no FMP API key is configured', async () => {
      redis.get.mockResolvedValue(null);
      (configService.get as jest.Mock).mockReturnValue('');

      const result = await service.getSectorRotation('sp500');

      expect(httpService.get).not.toHaveBeenCalled();
      expect(result.rows).toHaveLength(0);
    });

    it('reverses FMP array so dates are in chronological order (oldest first)', async () => {
      redis.get.mockResolvedValue(null);
      (configService.get as jest.Mock).mockReturnValue('FMP_KEY');
      httpService.get.mockReturnValue(of({ data: fmpResponse } as AxiosResponse));

      const result = await service.getSectorRotation('sp500');

      // FMP returns newest-first ([jan12, jan05]); after reversal dates = [jan05, jan12]
      expect(result.dates[0]).toBe('2024-01-05');
      expect(result.dates[1]).toBe('2024-01-12');
    });

    it('maps FMP field names to display sector names and values', async () => {
      redis.get.mockResolvedValue(null);
      (configService.get as jest.Mock).mockReturnValue('FMP_KEY');
      httpService.get.mockReturnValue(of({ data: fmpResponse } as AxiosResponse));

      const result = await service.getSectorRotation('sp500');

      const techRow = result.rows.find((r) => r.sector === 'Technology');
      expect(techRow).toBeDefined();
      // After reversal: changes[0] = jan05 value (0.8), changes[1] = jan12 value (1.2)
      expect(techRow!.changes[0]).toBeCloseTo(0.8);
      expect(techRow!.changes[1]).toBeCloseTo(1.2);

      const energyRow = result.rows.find((r) => r.sector === 'Energy');
      expect(energyRow!.changes[0]).toBeCloseTo(0.7);
      expect(energyRow!.changes[1]).toBeCloseTo(1.5);
    });

    it('returns all 11 sectors', async () => {
      redis.get.mockResolvedValue(null);
      (configService.get as jest.Mock).mockReturnValue('FMP_KEY');
      httpService.get.mockReturnValue(of({ data: fmpResponse } as AxiosResponse));

      const result = await service.getSectorRotation('sp500');

      expect(result.rows).toHaveLength(11);
      const sectorNames = result.rows.map((r) => r.sector);
      expect(sectorNames).toContain('Technology');
      expect(sectorNames).toContain('Financials');
      expect(sectorNames).toContain('Health Care');
      expect(sectorNames).toContain('Energy');
    });

    it('caches the result with a 1-hour TTL', async () => {
      redis.get.mockResolvedValue(null);
      (configService.get as jest.Mock).mockReturnValue('FMP_KEY');
      httpService.get.mockReturnValue(of({ data: fmpResponse } as AxiosResponse));

      await service.getSectorRotation('sp500');

      expect(redis.set).toHaveBeenCalledWith(
        'papi:sector:rotation:sp500',
        expect.any(String),
        3600,
      );
    });

    it('returns empty dates and empty changes arrays when FMP request fails', async () => {
      redis.get.mockResolvedValue(null);
      (configService.get as jest.Mock).mockReturnValue('FMP_KEY');
      httpService.get.mockReturnValue(throwError(() => new Error('FMP down')));

      const result = await service.getSectorRotation('sp500');

      // dates is empty; sector rows are still present but each has no data points
      expect(result.dates).toHaveLength(0);
      expect(result.rows).toHaveLength(11);
      expect(result.rows.every((r) => r.changes.length === 0)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // getFactorPerformance
  // -------------------------------------------------------------------------
  describe('getFactorPerformance', () => {
    it('returns cached tiles without calling price-processor', async () => {
      const cached = [
        { factor: 'Momentum', etf: 'MTUM', price: 200, change1d: 1, change1w: 2, change1m: 5 },
      ];
      redis.get.mockResolvedValue(JSON.stringify(cached));

      const result = await service.getFactorPerformance();

      expect(httpService.get).not.toHaveBeenCalled();
      expect(result[0]?.etf).toBe('MTUM');
    });

    it('fetches 22-bar daily history for each of the 6 factor ETFs', async () => {
      redis.get.mockResolvedValue(null);
      httpService.get.mockReturnValue(of({ data: makeBars(22) } as AxiosResponse<OHLCV[]>));

      await service.getFactorPerformance();

      // 6 ETFs × 1 history call each
      expect(httpService.get).toHaveBeenCalledTimes(6);
      expect(httpService.get).toHaveBeenCalledWith(
        expect.stringContaining('/prices/MTUM/history?limit=22&interval=1d'),
        expect.objectContaining({ timeout: 5000 }),
      );
    });

    it('computes 1D / 1W / 1M % changes with correct bar indices', async () => {
      redis.get.mockResolvedValue(null);

      // 22 bars: bar[0]=100, bar[1]=101, ..., bar[21]=121
      // price  = bar[21].close = 121
      // prev1d = bar[20].close = 120  → change1d = (121-120)/120*100 ≈ 0.833%
      // prev1w = bar[16].close = 116  → change1w = (121-116)/116*100 ≈ 4.310%
      // prev1m = bar[0].close  = 100  → change1m = (121-100)/100*100 = 21%
      const bars = makeBars(22, 100, 1);
      httpService.get.mockReturnValue(of({ data: bars } as AxiosResponse<OHLCV[]>));

      const result = await service.getFactorPerformance();

      const tile = result[0]!; // MTUM — all ETFs get the same history mock
      expect(tile.price).toBe(121);
      expect(tile.change1d).toBeCloseTo((1 / 120) * 100, 3);
      expect(tile.change1w).toBeCloseTo((5 / 116) * 100, 3);
      expect(tile.change1m).toBeCloseTo(21, 3);
    });

    it('returns six tiles, one per factor ETF', async () => {
      redis.get.mockResolvedValue(null);
      httpService.get.mockReturnValue(of({ data: makeBars(22) } as AxiosResponse<OHLCV[]>));

      const result = await service.getFactorPerformance();

      expect(result).toHaveLength(6);
      const etfs = result.map((t) => t.etf);
      expect(etfs).toEqual(['MTUM', 'VTV', 'VUG', 'VIG', 'USMV', 'QUAL']);
    });

    it('returns zero changes for an ETF when price-processor fails (Promise.allSettled)', async () => {
      redis.get.mockResolvedValue(null);
      httpService.get.mockReturnValue(throwError(() => new Error('price-processor down')));

      const result = await service.getFactorPerformance();

      expect(result).toHaveLength(6);
      for (const tile of result) {
        expect(tile.price).toBe(0);
        expect(tile.change1d).toBe(0);
        expect(tile.change1w).toBe(0);
        expect(tile.change1m).toBe(0);
      }
    });

    it('caches the result with a 15-minute TTL', async () => {
      redis.get.mockResolvedValue(null);
      httpService.get.mockReturnValue(of({ data: makeBars(22) } as AxiosResponse<OHLCV[]>));

      await service.getFactorPerformance();

      expect(redis.set).toHaveBeenCalledWith('papi:factors', expect.any(String), 900);
    });
  });
});
