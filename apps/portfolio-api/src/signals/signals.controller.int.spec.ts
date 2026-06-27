/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../app.module';
import { KafkaConsumerService } from '../kafka/kafka-consumer.service';
import { NewsService } from '../news/news.service';

const SYM = 'INT_TEST_SIGNALS';
const KEY_SENTIMENT = `papi:sentiment:${SYM}`;
const KEY_PREDICTION = `papi:prediction:${SYM}`;

function makeJwt(sub: string, email: string): string {
  const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, email, iat: Date.now() })).toString(
    'base64url',
  );
  return `${header}.${payload}.test-signature`;
}

const AUTH = `Bearer ${makeJwt('int-test-user', 'int@example.com')}`;

describe('SignalsController (integration)', () => {
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

  afterEach(async () => {
    await rawRedis.del(KEY_SENTIMENT, KEY_PREDICTION);
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await rawRedis.quit();
    await app.close();
  });

  it('returns 401 when Authorization header is missing', async () => {
    await request(server).get(`/signals/${SYM}`).expect(401);
  });

  it('returns null sentiment and prediction when Redis is empty', async () => {
    const { body } = await request(server)
      .get(`/signals/${SYM}`)
      .set('Authorization', AUTH)
      .expect(200);

    expect(body.symbol).toBe(SYM);
    expect(body.sentiment).toBeNull();
    expect(body.prediction).toBeNull();
  });

  it('returns cached sentiment signal when present in Redis', async () => {
    const sentiment = {
      symbol: SYM,
      label: 'positive',
      score: 0.88,
      source: 'reuters',
      headline: 'Test beats earnings',
      publishedAt: '2026-01-01T08:00:00.000Z',
      analyzedAt: '2026-01-01T09:00:00.000Z',
    };
    await rawRedis.setex(KEY_SENTIMENT, 172800, JSON.stringify(sentiment));

    const { body } = await request(server)
      .get(`/signals/${SYM}`)
      .set('Authorization', AUTH)
      .expect(200);

    expect(body.symbol).toBe(SYM);
    expect(body.sentiment).not.toBeNull();
    expect(body.sentiment.label).toBe('positive');
    expect(body.sentiment.score).toBe(0.88);
    expect(body.prediction).toBeNull();
  });

  it('returns cached prediction signal when present in Redis', async () => {
    const prediction = {
      symbol: SYM,
      currentPrice: 194.92,
      predictedPrice: 210.0,
      confidence: 0.75,
      horizon: '1d',
      model: 'prophet',
      generatedAt: '2026-01-01T12:00:00.000Z',
    };
    await rawRedis.setex(KEY_PREDICTION, 172800, JSON.stringify(prediction));

    const { body } = await request(server)
      .get(`/signals/${SYM}`)
      .set('Authorization', AUTH)
      .expect(200);

    expect(body.symbol).toBe(SYM);
    expect(body.sentiment).toBeNull();
    expect(body.prediction).not.toBeNull();
    expect(body.prediction.predictedPrice).toBe(210.0);
    expect(body.prediction.confidence).toBe(0.75);
  });

  it('returns both sentiment and prediction when both are cached', async () => {
    const sentiment = {
      symbol: SYM,
      label: 'negative',
      score: 0.65,
      source: 'bloomberg',
      headline: 'Outlook cautious',
      publishedAt: '2026-01-01T08:00:00.000Z',
      analyzedAt: '2026-01-01T09:00:00.000Z',
    };
    const prediction = {
      symbol: SYM,
      currentPrice: 180.0,
      predictedPrice: 175.0,
      confidence: 0.6,
      horizon: '1d',
      model: 'prophet',
      generatedAt: '2026-01-01T12:00:00.000Z',
    };
    await rawRedis.setex(KEY_SENTIMENT, 172800, JSON.stringify(sentiment));
    await rawRedis.setex(KEY_PREDICTION, 172800, JSON.stringify(prediction));

    const { body } = await request(server)
      .get(`/signals/${SYM}`)
      .set('Authorization', AUTH)
      .expect(200);

    expect(body.sentiment.label).toBe('negative');
    expect(body.prediction.predictedPrice).toBe(175.0);
  });

  it('uppercases the symbol before Redis lookup', async () => {
    const sentiment = {
      symbol: SYM,
      label: 'neutral',
      score: 0.5,
      source: 'ap',
      headline: 'Mixed signals',
      publishedAt: '2026-01-01T08:00:00.000Z',
      analyzedAt: '2026-01-01T09:00:00.000Z',
    };
    await rawRedis.setex(KEY_SENTIMENT, 172800, JSON.stringify(sentiment));

    const { body } = await request(server)
      .get(`/signals/${SYM.toLowerCase()}`)
      .set('Authorization', AUTH)
      .expect(200);

    // The lookup uses the uppercased key, so sentiment is found
    expect(body.sentiment).not.toBeNull();
    expect(body.sentiment.label).toBe('neutral');
  });
});
