/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { KafkaConsumerService } from '../kafka/kafka-consumer.service';
import type { NewsArticle } from './news.service';
import { NewsService } from './news.service';

function makeJwt(sub: string, email: string): string {
  const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, email, iat: Date.now() })).toString(
    'base64url',
  );
  return `${header}.${payload}.test-signature`;
}

const AUTH = `Bearer ${makeJwt('int-test-user', 'int@example.com')}`;

const MOCK_ARTICLES: NewsArticle[] = [
  {
    headline: 'NVIDIA Reports Record Revenue',
    source: 'Reuters',
    url: 'https://example.com/1',
    publishedAt: '2026-01-01T08:00:00.000Z',
    sentimentLabel: 'positive',
    sentimentScore: 0.92,
  },
  {
    headline: 'AI Chip Demand Surges Ahead of Earnings',
    source: 'Bloomberg',
    url: 'https://example.com/2',
    publishedAt: '2026-01-01T07:00:00.000Z',
    sentimentLabel: 'positive',
    sentimentScore: 0.85,
  },
  {
    headline: 'Supply Chain Concerns Weigh on Outlook',
    source: 'FT',
    url: 'https://example.com/3',
    publishedAt: '2026-01-01T06:00:00.000Z',
    sentimentLabel: 'negative',
    sentimentScore: 0.71,
  },
];

describe('NewsController (integration)', () => {
  let app: INestApplication;
  let server: Server;
  let newsGetSpy: jest.Mock;

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
    newsGetSpy = newsServiceMock.getNews;
  });

  afterEach(() => {
    jest.clearAllMocks();
    newsGetSpy.mockResolvedValue([]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 401 when Authorization header is missing', async () => {
    await request(server).get('/news/NVDA').expect(401);
  });

  it('returns an empty array when the news service has no articles', async () => {
    const { body } = await request(server).get('/news/NVDA').set('Authorization', AUTH).expect(200);

    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it('returns articles from the news service', async () => {
    newsGetSpy.mockResolvedValue(MOCK_ARTICLES);

    const { body } = await request(server).get('/news/NVDA').set('Authorization', AUTH).expect(200);

    expect(body).toHaveLength(3);
    expect(body[0].headline).toBe('NVIDIA Reports Record Revenue');
    expect(body[0].sentimentLabel).toBe('positive');
    expect(body[0].sentimentScore).toBe(0.92);
    expect(body[0].source).toBe('Reuters');
  });

  it('uppercases the symbol before passing to the service', async () => {
    newsGetSpy.mockResolvedValue(MOCK_ARTICLES);

    await request(server).get('/news/nvda').set('Authorization', AUTH).expect(200);

    expect(newsGetSpy).toHaveBeenCalledWith('NVDA', expect.any(Number));
  });

  it('defaults to limit 10 when no limit param is provided', async () => {
    await request(server).get('/news/NVDA').set('Authorization', AUTH).expect(200);

    expect(newsGetSpy).toHaveBeenCalledWith('NVDA', 10);
  });

  it('passes the limit query param to the service', async () => {
    await request(server).get('/news/NVDA?limit=5').set('Authorization', AUTH).expect(200);

    expect(newsGetSpy).toHaveBeenCalledWith('NVDA', 5);
  });

  it('caps the limit at 50 regardless of the query param value', async () => {
    await request(server).get('/news/NVDA?limit=200').set('Authorization', AUTH).expect(200);

    expect(newsGetSpy).toHaveBeenCalledWith('NVDA', 50);
  });

  it('articles include expected shape fields', async () => {
    newsGetSpy.mockResolvedValue([MOCK_ARTICLES[0]]);

    const { body } = await request(server).get('/news/NVDA').set('Authorization', AUTH).expect(200);

    const article = body[0];
    expect(article).toHaveProperty('headline');
    expect(article).toHaveProperty('source');
    expect(article).toHaveProperty('url');
    expect(article).toHaveProperty('publishedAt');
    expect(article).toHaveProperty('sentimentLabel');
    expect(article).toHaveProperty('sentimentScore');
  });
});
