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
  });
});
