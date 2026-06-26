import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../app.module';
import { KafkaConsumerService } from '../kafka/kafka-consumer.service';
import { NewsService } from '../news/news.service';

const SYM = 'INT_TEST_ANALYST';
const CACHE_KEY = `papi:analyst:${SYM}`;

function makeJwt(sub: string, email: string): string {
  const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, email, iat: Date.now() })).toString(
    'base64url',
  );
  return `${header}.${payload}.test-signature`;
}

const AUTH = `Bearer ${makeJwt('int-test-user', 'int@example.com')}`;

describe('AnalystController (integration)', () => {
  let app: INestApplication;
  let server: Server;
  let rawRedis: Redis;

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
    await app.init();
    server = app.getHttpServer() as Server;

    rawRedis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379');
  });

  afterAll(async () => {
    await rawRedis.del(CACHE_KEY);
    await rawRedis.quit();
    await app.close();
  });

  afterEach(async () => {
    await rawRedis.del(CACHE_KEY);
    jest.clearAllMocks();
  });

  it('returns 401 without auth header', async () => {
    await request(server).get(`/stocks/${SYM}/analyst`).expect(401);
  });

  it('returns empty rating when no FMP key is configured', async () => {
    const saved = process.env['FMP_API_KEY'];
    delete process.env['FMP_API_KEY'];

    const res = await request(server)
      .get(`/stocks/${SYM}/analyst`)
      .set('Authorization', AUTH)
      .expect(200);

    expect(res.body).toMatchObject({
      analystCount: 0,
      consensus: null,
      priceTarget: null,
      strongBuy: 0,
      buy: 0,
      hold: 0,
      sell: 0,
      strongSell: 0,
    });

    if (saved !== undefined) process.env['FMP_API_KEY'] = saved;
  });

  it('serves cached analyst rating from Redis', async () => {
    const cached = {
      strongBuy: 8,
      buy: 4,
      hold: 2,
      sell: 0,
      strongSell: 0,
      analystCount: 14,
      priceTarget: 180,
      consensus: 'strongBuy',
      asOf: '2024-01-01',
    };
    await rawRedis.set(CACHE_KEY, JSON.stringify(cached));

    const res = await request(server)
      .get(`/stocks/${SYM}/analyst`)
      .set('Authorization', AUTH)
      .expect(200);

    expect(res.body.strongBuy).toBe(8);
    expect(res.body.priceTarget).toBe(180);
    expect(res.body.consensus).toBe('strongBuy');
    expect(res.body.analystCount).toBe(14);
  });

  it('symbol is uppercased before cache lookup', async () => {
    const cached = {
      strongBuy: 3,
      buy: 1,
      hold: 5,
      sell: 0,
      strongSell: 0,
      analystCount: 9,
      priceTarget: null,
      consensus: 'hold',
      asOf: '2024-01-01',
    };
    await rawRedis.set(CACHE_KEY, JSON.stringify(cached));

    const res = await request(server)
      .get(`/stocks/${SYM.toLowerCase()}/analyst`)
      .set('Authorization', AUTH)
      .expect(200);

    expect(res.body.consensus).toBe('hold');
  });
});
