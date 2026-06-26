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
  });

  describe('getOverview', () => {
    const fmpIndices = [
      { symbol: '^GSPC', name: 'S&P 500', price: 5200, change: 26, changesPercentage: 0.5 },
      { symbol: '^IXIC', name: 'Nasdaq', price: 18000, change: -50, changesPercentage: -0.27 },
    ];
    const fmpSectors = [
      { sector: 'Technology', changesPercentage: '+1.52%' },
      { sector: 'Health Care', changesPercentage: '-0.23%' },
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

    it('returns overview from FMP and caches it', async () => {
      redis.get.mockResolvedValue(null);
      (configService.get as jest.Mock).mockReturnValue('FMP_KEY');

      httpService.get
        .mockReturnValueOnce(of({ data: fmpIndices } as AxiosResponse))
        .mockReturnValueOnce(of({ data: fmpSectors } as AxiosResponse))
        .mockReturnValueOnce(of({ data: fmpNews } as AxiosResponse));

      const result = await service.getOverview();

      expect(result.indices).toHaveLength(2);
      expect(result.indices[0]?.symbol).toBe('^GSPC');
      expect(result.indices[0]?.name).toBe('S&P 500');
      expect(result.sectors).toHaveLength(2);
      expect(result.sectors[0]?.changesPercentage).toBeCloseTo(1.52);
      expect(result.sectors[1]?.changesPercentage).toBeCloseTo(-0.23);
      expect(result.news).toHaveLength(1);
      expect(result.news[0]?.title).toBe('Markets rally on Fed optimism');
      expect(redis.set).toHaveBeenCalledWith('papi:overview', expect.any(String), 300);
    });

    it('returns cached overview without hitting FMP', async () => {
      const cached = { indices: fmpIndices, sectors: [], news: [] };
      redis.get.mockResolvedValue(JSON.stringify(cached));

      const result = await service.getOverview();

      expect(httpService.get).not.toHaveBeenCalled();
      expect(result.indices).toHaveLength(2);
    });

    it('returns empty overview when FMP_API_KEY is not set', async () => {
      redis.get.mockResolvedValue(null);
      (configService.get as jest.Mock).mockReturnValue('');

      const result = await service.getOverview();

      expect(httpService.get).not.toHaveBeenCalled();
      expect(result.indices).toHaveLength(0);
      expect(result.sectors).toHaveLength(0);
      expect(result.news).toHaveLength(0);
    });

    it('returns partial data when one FMP call fails', async () => {
      redis.get.mockResolvedValue(null);
      (configService.get as jest.Mock).mockReturnValue('FMP_KEY');

      httpService.get
        .mockReturnValueOnce(of({ data: fmpIndices } as AxiosResponse))
        .mockReturnValueOnce(throwError(() => new Error('sectors down')))
        .mockReturnValueOnce(of({ data: fmpNews } as AxiosResponse));

      const result = await service.getOverview();

      expect(result.indices).toHaveLength(2);
      expect(result.sectors).toHaveLength(0);
      expect(result.news).toHaveLength(1);
    });
  });
});
