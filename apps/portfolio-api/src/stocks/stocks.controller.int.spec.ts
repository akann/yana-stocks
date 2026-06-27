/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import type { Server } from 'node:http';
import { HttpService } from '@nestjs/axios';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AxiosResponse } from 'axios';
import Redis from 'ioredis';
import { of, throwError } from 'rxjs';
import request from 'supertest';
import { AppModule } from '../app.module';
import { KafkaConsumerService } from '../kafka/kafka-consumer.service';
import { NewsService } from '../news/news.service';
import type { PriceCacheEntry } from './price-cache.types';

// Unique symbol prefix to avoid colliding with real prod data in shared Redis
const SYM = 'INT_TEST_XXX';
const KEY_PRICE = `papi:price:${SYM}`;
const KEY_SENTIMENT = `papi:sentiment:${SYM}`;
const KEY_PREDICTION = `papi:prediction:${SYM}`;
const KEY_HISTORY = `papi:history:${SYM}:100:1m`;
const KEY_MOVERS = 'papi:movers';

function makeJwt(sub: string, email: string): string {
  const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, email, iat: Date.now() })).toString(
    'base64url',
  );
  return `${header}.${payload}.test-signature`;
}

const AUTH = `Bearer ${makeJwt('int-test-user', 'int@example.com')}`;

const mockPrice: PriceCacheEntry = {
  price: 194.92,
  prevPrice: 185.0,
  change: 9.92,
  changePercent: 5.36,
  volume: 1_200_000,
  timestamp: '2026-01-01T15:00:00Z',
};

describe('StocksController (integration)', () => {
  let app: INestApplication;
  let server: Server;
  let rawRedis: Redis;
  let httpService: jest.Mocked<HttpService>;

  const kafkaConsumerMock = {
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
  };

  const newsServiceMock = {
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
    getNews: jest.fn().mockResolvedValue([]),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(KafkaConsumerService)
      .useValue(kafkaConsumerMock)
      .overrideProvider(NewsService)
      .useValue(newsServiceMock)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    server = app.getHttpServer() as Server;
    httpService = moduleRef.get<jest.Mocked<HttpService>>(HttpService);
    rawRedis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379');
  });

  afterEach(async () => {
    await rawRedis.del(KEY_PRICE, KEY_SENTIMENT, KEY_PREDICTION, KEY_HISTORY, KEY_MOVERS);
    jest.clearAllMocks();
  });

  afterAll(async () => {
    rawRedis.disconnect();
    await app.close();
  });

  // ─── Auth guard ───────────────────────────────────────────────────────────

  describe('UserFromTokenGuard', () => {
    it('returns 401 when Authorization header is missing', async () => {
      await request(server).get(`/stocks/${SYM}`).expect(401);
    });

    it('returns 401 for a malformed token (not 3 dot-separated parts)', async () => {
      await request(server)
        .get(`/stocks/${SYM}`)
        .set('Authorization', 'Bearer not.a.valid.jwt.here')
        .expect(401);
    });

    it('passes auth and returns 200 for a well-formed JWT', async () => {
      // Redis is cold, HttpService fallback will throw — but auth must pass first
      jest.spyOn(httpService, 'get').mockReturnValue(throwError(() => new Error('offline')));
      await request(server).get(`/stocks/${SYM}`).set('Authorization', AUTH).expect(200);
    });
  });

  // ─── GET /stocks/:symbol ──────────────────────────────────────────────────

  describe('GET /stocks/:symbol', () => {
    it('returns aggregated price data from the Redis cache', async () => {
      await rawRedis.setex(KEY_PRICE, 900, JSON.stringify(mockPrice));

      const { body } = await request(server)
        .get(`/stocks/${SYM}`)
        .set('Authorization', AUTH)
        .expect(200);

      expect(body.symbol).toBe(SYM);
      expect(body.price).toBe(194.92);
      expect(body.change).toBeCloseTo(9.92, 2);
      expect(body.changePercent).toBeCloseTo(5.36, 2);
    });

    it('includes sentiment and prediction from Redis when cached', async () => {
      const sentiment = {
        symbol: SYM,
        label: 'positive',
        score: 0.88,
        source: 'reuters',
        headline: 'Test beats earnings',
        publishedAt: '2026-01-01T08:00:00Z',
        analyzedAt: '2026-01-01T09:00:00Z',
      };
      const prediction = {
        symbol: SYM,
        currentPrice: 194.92,
        predictedPrice: 210.0,
        confidence: 0.75,
        horizon: '1d',
        model: 'prophet',
        generatedAt: '2026-01-01T12:00:00Z',
      };
      await rawRedis.setex(KEY_PRICE, 900, JSON.stringify(mockPrice));
      await rawRedis.setex(KEY_SENTIMENT, 172800, JSON.stringify(sentiment));
      await rawRedis.setex(KEY_PREDICTION, 172800, JSON.stringify(prediction));

      const { body } = await request(server)
        .get(`/stocks/${SYM}`)
        .set('Authorization', AUTH)
        .expect(200);

      expect(body.sentiment?.label).toBe('positive');
      expect(body.prediction?.predictedPrice).toBe(210.0);
    });

    it('falls back to HttpService when Redis has no price, caches the result', async () => {
      jest
        .spyOn(httpService, 'get')
        .mockReturnValue(of({ data: mockPrice } as AxiosResponse<PriceCacheEntry>));

      const { body } = await request(server)
        .get(`/stocks/${SYM}`)
        .set('Authorization', AUTH)
        .expect(200);

      expect(body.price).toBe(194.92);

      // The fetched value must now be cached in Redis
      const cached = await rawRedis.get(KEY_PRICE);
      expect(cached).not.toBeNull();
      expect((JSON.parse(cached!) as PriceCacheEntry).price).toBe(194.92);
    });

    it('returns null price fields when Redis is cold and HttpService fails', async () => {
      jest.spyOn(httpService, 'get').mockReturnValue(throwError(() => new Error('offline')));

      const { body } = await request(server)
        .get(`/stocks/${SYM}`)
        .set('Authorization', AUTH)
        .expect(200);

      expect(body.price).toBeNull();
      expect(body.change).toBeNull();
      expect(body.sentiment).toBeNull();
    });
  });

  // ─── GET /stocks/:symbol/history ─────────────────────────────────────────

  describe('GET /stocks/:symbol/history', () => {
    it('returns 401 without auth', async () => {
      await request(server).get(`/stocks/${SYM}/history`).expect(401);
    });

    it('returns cached OHLCV bars from Redis', async () => {
      const bars = [
        {
          symbol: SYM,
          timestamp: '2026-01-01T10:00:00.000Z',
          open: 190,
          high: 198,
          low: 189,
          close: 195,
          volume: 500_000,
          interval: '1m',
        },
      ];
      await rawRedis.setex(KEY_HISTORY, 30, JSON.stringify(bars));

      const { body } = await request(server)
        .get(`/stocks/${SYM}/history`)
        .set('Authorization', AUTH)
        .expect(200);

      expect(body).toHaveLength(1);
      expect(body[0].close).toBe(195);
      expect(body[0].symbol).toBe(SYM);
    });

    it('fetches from HttpService on cache miss and caches the result', async () => {
      const bars = [
        {
          symbol: SYM,
          timestamp: new Date('2026-01-01T10:00:00Z'),
          open: 190,
          high: 198,
          low: 189,
          close: 195,
          volume: 500_000,
          interval: '1m',
        },
      ];
      jest
        .spyOn(httpService, 'get')
        .mockReturnValue(of({ data: bars } as AxiosResponse<typeof bars>));

      const { body } = await request(server)
        .get(`/stocks/${SYM}/history`)
        .set('Authorization', AUTH)
        .expect(200);

      expect(body).toHaveLength(1);
      const cached = await rawRedis.get(KEY_HISTORY);
      expect(cached).not.toBeNull();
    });

    it('returns 500 when Redis is cold and HttpService also fails', async () => {
      jest.spyOn(httpService, 'get').mockReturnValue(throwError(() => new Error('offline')));

      await request(server).get(`/stocks/${SYM}/history`).set('Authorization', AUTH).expect(500);
    });
  });

  // ─── GET /market/movers ───────────────────────────────────────────────────

  describe('GET /market/movers', () => {
    it('does not require authentication', async () => {
      jest.spyOn(httpService, 'get').mockReturnValue(throwError(() => new Error('offline')));
      const { body } = await request(server).get('/market/movers').expect(200);
      // Shape check only — shared Redis may have real price data, so gainers/losers are non-empty
      expect(Array.isArray(body.gainers)).toBe(true);
      expect(Array.isArray(body.losers)).toBe(true);
    });

    it('builds gainers and losers from Redis price keys', async () => {
      // Use extreme changePercent values to dominate any real data already in Redis
      const entries: [string, PriceCacheEntry][] = [
        [
          'papi:price:INT_A',
          {
            price: 200,
            prevPrice: 100,
            change: 100,
            changePercent: 999.99,
            volume: 1_000_000,
            timestamp: 't',
          },
        ],
        [
          'papi:price:INT_B',
          {
            price: 1,
            prevPrice: 100,
            change: -99,
            changePercent: -999.99,
            volume: 500_000,
            timestamp: 't',
          },
        ],
        [
          'papi:price:INT_C',
          {
            price: 150,
            prevPrice: 148,
            change: 2,
            changePercent: 1.35,
            volume: 750_000,
            timestamp: 't',
          },
        ],
      ];

      jest.spyOn(httpService, 'get').mockReturnValue(throwError(() => new Error('offline')));
      // Delete movers cache so the scan path is exercised
      await rawRedis.del(KEY_MOVERS);
      for (const [key, entry] of entries) {
        await rawRedis.setex(key, 300, JSON.stringify(entry));
      }

      try {
        const { body } = await request(server).get('/market/movers?top=1').expect(200);

        // INT_A (999.99%) should be the top gainer; INT_B (-999.99%) should be the top loser
        expect(body.gainers[0]?.symbol).toBe('INT_A');
        expect(body.gainers[0]?.changePercent).toBeCloseTo(999.99, 1);
        expect(body.losers[0]?.symbol).toBe('INT_B');
        expect(body.losers[0]?.changePercent).toBeCloseTo(-999.99, 1);
      } finally {
        await rawRedis.del('papi:price:INT_A', 'papi:price:INT_B', 'papi:price:INT_C', KEY_MOVERS);
      }
    });

    it('serves the cached movers on a second call without re-scanning Redis', async () => {
      const cached = {
        gainers: [{ symbol: 'CACHE_HIT', price: 100, change: 5, changePercent: 5.0, volume: 1 }],
        losers: [],
      };
      await rawRedis.setex(KEY_MOVERS, 10, JSON.stringify(cached));

      const { body } = await request(server).get('/market/movers').expect(200);

      expect(body.gainers[0]?.symbol).toBe('CACHE_HIT');
      // scan must not have been called — if it had, empty Redis would return [] not our cached data
    });

    it('respects the ?top=N query parameter', async () => {
      const symbols = ['INT_D', 'INT_E', 'INT_F', 'INT_G', 'INT_H', 'INT_I'];
      const keys = symbols.map((s) => `papi:price:${s}`);
      jest.spyOn(httpService, 'get').mockReturnValue(throwError(() => new Error('offline')));
      for (let i = 0; i < symbols.length; i++) {
        await rawRedis.setex(
          keys[i]!,
          300,
          JSON.stringify({
            price: 100 + i,
            prevPrice: 100,
            change: i,
            changePercent: i,
            volume: 1,
            timestamp: 't',
          }),
        );
      }

      try {
        const { body } = await request(server).get('/market/movers?top=3').expect(200);
        expect(body.gainers).toHaveLength(3);
        expect(body.losers).toHaveLength(3);
      } finally {
        await rawRedis.del(...keys);
      }
    });
  });

  // ─── GET /market/overview ─────────────────────────────────────────────────

  describe('GET /market/overview', () => {
    it('returns empty overview when FMP_API_KEY is not configured', async () => {
      const { body } = await request(server).get('/market/overview').expect(200);

      expect(body).toHaveProperty('indices');
      expect(body).toHaveProperty('sectors');
      expect(body).toHaveProperty('news');
      expect(Array.isArray(body.indices)).toBe(true);
      expect(Array.isArray(body.sectors)).toBe(true);
      expect(Array.isArray(body.news)).toBe(true);
    });

    it('serves cached overview from Redis', async () => {
      const cached = {
        indices: [
          { symbol: '^GSPC', name: 'S&P 500', price: 5200, change: 10, changesPercentage: 0.2 },
        ],
        sectors: [{ sector: 'Technology', changesPercentage: 1.5 }],
        news: [
          {
            title: 'Test headline',
            url: 'https://x.com',
            publishedAt: '',
            source: 'Reuters',
            summary: '',
          },
        ],
      };
      await rawRedis.setex('papi:overview', 300, JSON.stringify(cached));

      const { body } = await request(server).get('/market/overview').expect(200);

      expect(body.indices).toHaveLength(1);
      expect(body.indices[0].symbol).toBe('^GSPC');
      expect(body.sectors[0].sector).toBe('Technology');
      expect(body.news[0].title).toBe('Test headline');

      await rawRedis.del('papi:overview');
    });
  });

  // ─── GET /market/assets ───────────────────────────────────────────────────

  describe('GET /market/assets', () => {
    it('returns paginated MOCK_ASSETS when no Massive API key is configured', async () => {
      const { body } = await request(server)
        .get('/market/assets?market=us&page=1&limit=5')
        .expect(200);

      expect(body.data).toHaveLength(5);
      expect(body.total).toBeGreaterThan(5);
      expect(body.page).toBe(1);
      expect(body.limit).toBe(5);
      expect(body.data[0]).toHaveProperty('assetClass', 'us_equity');
    });

    it('returns paginated MOCK_ETF_ASSETS for market=etf', async () => {
      const { body } = await request(server)
        .get('/market/assets?market=etf&page=1&limit=5')
        .expect(200);

      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data[0]).toHaveProperty('assetClass', 'us_etf');
    });

    it('defaults to us market when no market param is provided', async () => {
      const { body } = await request(server).get('/market/assets?page=1&limit=5').expect(200);

      expect(body.data[0]).toHaveProperty('assetClass', 'us_equity');
    });

    it('filters assets by symbol prefix (case-insensitive)', async () => {
      const { body } = await request(server)
        .get('/market/assets?market=us&search=aapl&page=1&limit=10')
        .expect(200);

      expect(body.data.every((a: { symbol: string }) => a.symbol.includes('AAPL'))).toBe(true);
    });

    it('returns an empty data array when no assets match the search term', async () => {
      const { body } = await request(server)
        .get('/market/assets?market=us&search=ZZZNOTEXIST&page=1&limit=10')
        .expect(200);

      expect(body.data).toHaveLength(0);
      expect(body.total).toBe(0);
    });

    it('caps limit at 100 regardless of query param', async () => {
      const { body } = await request(server)
        .get('/market/assets?market=us&page=1&limit=999')
        .expect(200);

      expect(body.data.length).toBeLessThanOrEqual(100);
    });

    it('returns paginated MOCK_UK_ASSETS for market=uk', async () => {
      const { body } = await request(server)
        .get('/market/assets?market=uk&page=1&limit=5')
        .expect(200);

      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data[0]).toHaveProperty('assetClass', 'uk_equity');
      // UK symbols have the .L suffix
      expect(body.data[0].symbol).toMatch(/\.L$/);
    });

    it('returns merged assets for market=all including UK symbols', async () => {
      // Searching for a UK-specific symbol (HSBA.L) proves the merge includes uk_equity.
      // The first page of an unfiltered market=all result is dominated by MOCK_ASSETS
      // (230+ us_equity entries), so we filter by symbol instead.
      const { body } = await request(server)
        .get('/market/assets?market=all&search=HSBA.L&page=1&limit=10')
        .expect(200);

      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data[0].symbol).toBe('HSBA.L');
      expect(body.data[0]).toHaveProperty('assetClass', 'uk_equity');
    });
  });

  // ─── GET /market/screener ─────────────────────────────────────────────────

  describe('GET /market/screener', () => {
    it('does not require authentication', async () => {
      const { body } = await request(server).get('/market/screener').expect(200);
      expect(Array.isArray(body)).toBe(true);
    });

    it('returns empty array when FMP_API_KEY is not configured', async () => {
      const saved = process.env['FMP_API_KEY'];
      delete process.env['FMP_API_KEY'];

      const { body } = await request(server).get('/market/screener').expect(200);
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(0);

      if (saved !== undefined) process.env['FMP_API_KEY'] = saved;
    });

    it('serves cached screener results from Redis', async () => {
      const cached = [
        {
          symbol: 'CACHE_SCR',
          name: 'Cache Test Corp',
          price: 100,
          changesPercentage: 1.5,
          marketCap: 1_000_000_000,
          volume: 500_000,
          dividendYield: 1.2,
          sector: 'Technology',
        },
      ];
      await rawRedis.setex('papi:screener:profiles', 3600, JSON.stringify(cached));

      try {
        const { body } = await request(server).get('/market/screener').expect(200);
        expect(body[0]?.symbol).toBe('CACHE_SCR');
      } finally {
        await rawRedis.del('papi:screener:profiles');
      }
    });

    it('filters by sector when sector param is provided', async () => {
      const profiles = [
        {
          symbol: 'TECH1',
          name: 'Tech One',
          price: 100,
          changesPercentage: 1,
          marketCap: 500_000_000,
          volume: 100_000,
          dividendYield: 0,
          sector: 'Technology',
        },
        {
          symbol: 'HEALTH1',
          name: 'Health One',
          price: 50,
          changesPercentage: 0.5,
          marketCap: 300_000_000,
          volume: 50_000,
          dividendYield: 0.5,
          sector: 'Health Care',
        },
      ];
      await rawRedis.setex('papi:screener:profiles', 3600, JSON.stringify(profiles));

      try {
        const { body } = await request(server)
          .get('/market/screener?sector=Technology')
          .expect(200);
        expect(body.every((r: { sector: string }) => r.sector === 'Technology')).toBe(true);
      } finally {
        await rawRedis.del('papi:screener:profiles');
      }
    });

    it('respects the limit query parameter', async () => {
      const profiles = Array.from({ length: 10 }, (_, i) => ({
        symbol: `SCR${i}`,
        name: `Screener ${i}`,
        price: 100 + i,
        changesPercentage: i,
        marketCap: (10 - i) * 100_000_000,
        volume: 100_000,
        dividendYield: 0,
        sector: 'Technology',
      }));
      await rawRedis.setex('papi:screener:profiles', 3600, JSON.stringify(profiles));

      try {
        const { body } = await request(server).get('/market/screener?limit=3').expect(200);
        expect(body).toHaveLength(3);
      } finally {
        await rawRedis.del('papi:screener:profiles');
      }
    });
  });

  // ─── GET /market/sectors/rotation ────────────────────────────────────────

  describe('GET /market/sectors/rotation', () => {
    const ROTATION_KEY_SP500 = 'papi:sector:rotation:sp500';
    const ROTATION_KEY_FTSE = 'papi:sector:rotation:ftse100';

    afterEach(async () => {
      await rawRedis.del(ROTATION_KEY_SP500, ROTATION_KEY_FTSE);
    });

    it('does not require authentication', async () => {
      const { body } = await request(server).get('/market/sectors/rotation').expect(200);
      expect(body).toHaveProperty('dates');
      expect(body).toHaveProperty('rows');
    });

    it('returns empty dates and rows when no API keys are configured (sp500)', async () => {
      const saved = process.env['FMP_API_KEY'];
      delete process.env['FMP_API_KEY'];

      const { body } = await request(server)
        .get('/market/sectors/rotation?index=sp500')
        .expect(200);
      expect(Array.isArray(body.dates)).toBe(true);
      expect(Array.isArray(body.rows)).toBe(true);

      if (saved !== undefined) process.env['FMP_API_KEY'] = saved;
    });

    it('serves cached sp500 rotation from Redis', async () => {
      const cached = {
        dates: ['2026-01-06', '2026-01-07'],
        rows: [
          { sector: 'Technology', changes: [1.5, 2.1] },
          { sector: 'Financials', changes: [0.8, -0.3] },
        ],
      };
      await rawRedis.setex(ROTATION_KEY_SP500, 3600, JSON.stringify(cached));

      const { body } = await request(server)
        .get('/market/sectors/rotation?index=sp500')
        .expect(200);

      expect(body.dates).toEqual(['2026-01-06', '2026-01-07']);
      expect(body.rows[0].sector).toBe('Technology');
      expect(body.rows[0].changes).toHaveLength(2);
    });

    it('serves cached ftse100 rotation from Redis', async () => {
      const cached = {
        dates: ['2026-01-06'],
        rows: [{ sector: 'Financials', changes: [0.4] }],
      };
      await rawRedis.setex(ROTATION_KEY_FTSE, 3600, JSON.stringify(cached));

      const { body } = await request(server)
        .get('/market/sectors/rotation?index=ftse100')
        .expect(200);

      expect(body.rows[0].sector).toBe('Financials');
    });

    it('defaults to sp500 when index param is not provided', async () => {
      const cached = {
        dates: ['2026-01-06'],
        rows: [{ sector: 'Technology', changes: [1.0] }],
      };
      await rawRedis.setex(ROTATION_KEY_SP500, 3600, JSON.stringify(cached));

      const { body } = await request(server).get('/market/sectors/rotation').expect(200);
      expect(body.rows[0].sector).toBe('Technology');
    });
  });

  // ─── GET /market/factors ─────────────────────────────────────────────────

  describe('GET /market/factors', () => {
    const FACTORS_KEY = 'papi:factors';

    afterEach(async () => {
      await rawRedis.del(FACTORS_KEY);
    });

    it('does not require authentication', async () => {
      jest.spyOn(httpService, 'get').mockReturnValue(throwError(() => new Error('offline')));
      const { body } = await request(server).get('/market/factors').expect(200);
      expect(Array.isArray(body)).toBe(true);
    });

    it('returns 6 factor tiles when HttpService is offline', async () => {
      jest.spyOn(httpService, 'get').mockReturnValue(throwError(() => new Error('offline')));

      const { body } = await request(server).get('/market/factors').expect(200);

      expect(body).toHaveLength(6);
      const factors = (body as Array<{ factor: string }>).map((t) => t.factor);
      expect(factors).toContain('Momentum');
      expect(factors).toContain('Value');
      expect(factors).toContain('Growth');
      expect(factors).toContain('Dividend');
      expect(factors).toContain('Low Volatility');
      expect(factors).toContain('Quality');
    });

    it('factor tiles have the expected shape', async () => {
      jest.spyOn(httpService, 'get').mockReturnValue(throwError(() => new Error('offline')));

      const { body } = await request(server).get('/market/factors').expect(200);

      const tile = body[0];
      expect(tile).toHaveProperty('factor');
      expect(tile).toHaveProperty('etf');
      expect(tile).toHaveProperty('price');
      expect(tile).toHaveProperty('change1d');
      expect(tile).toHaveProperty('change1w');
      expect(tile).toHaveProperty('change1m');
    });

    it('serves cached factor tiles from Redis', async () => {
      const cached = [
        {
          factor: 'Momentum',
          etf: 'MTUM',
          price: 200,
          change1d: 1.2,
          change1w: 3.4,
          change1m: 8.1,
        },
      ];
      await rawRedis.setex(FACTORS_KEY, 900, JSON.stringify(cached));

      const { body } = await request(server).get('/market/factors').expect(200);

      expect(body).toHaveLength(1);
      expect(body[0].factor).toBe('Momentum');
      expect(body[0].price).toBe(200);
    });
  });
});
