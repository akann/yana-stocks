import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { TradeType } from '@yana-stocks/shared-types';
import { Model } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../app.module';
import { KafkaConsumerService } from '../kafka/kafka-consumer.service';
import { Trade } from './schemas/trade.schema';

interface TradeResponse {
  id: string;
  portfolioId: string;
  userId: string;
  symbol: string;
  type: TradeType;
  shares: number;
  price: number;
  totalAmount: number;
  executedAt: string;
}

function makeTestJwt(sub: string, email: string): string {
  const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, email, iat: Date.now() })).toString(
    'base64url',
  );
  return `${header}.${payload}.test-signature`;
}

const USER_A_ID = 'trade-int-user-a';
const USER_B_ID = 'trade-int-user-b';
const AUTH_A = `Bearer ${makeTestJwt(USER_A_ID, 'user-a@example.com')}`;
const AUTH_B = `Bearer ${makeTestJwt(USER_B_ID, 'user-b@example.com')}`;

const seedTrade = (model: Model<Trade>, userId: string, symbol: string) =>
  model.create({
    portfolioId: 'test-portfolio',
    userId,
    symbol,
    type: 'buy' as TradeType,
    shares: 10,
    price: 100,
    totalAmount: 1000,
    executedAt: new Date(),
  });

describe('TradesController (integration)', () => {
  let app: INestApplication;
  let server: Server;
  let tradeModel: Model<Trade>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(KafkaConsumerService)
      .useValue({ onModuleInit: jest.fn(), onModuleDestroy: jest.fn() })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    server = app.getHttpServer() as Server;
    tradeModel = moduleRef.get(getModelToken(Trade.name));
  });

  afterEach(async () => {
    await tradeModel.deleteMany({ userId: { $in: [USER_A_ID, USER_B_ID] } });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /trades — cross-tenant isolation', () => {
    it('returns 401 without an Authorization header', async () => {
      await request(server).get('/trades').expect(401);
    });

    it("returns only the requesting user's trades", async () => {
      await seedTrade(tradeModel, USER_A_ID, 'AAPL');
      await seedTrade(tradeModel, USER_A_ID, 'MSFT');
      await seedTrade(tradeModel, USER_B_ID, 'TSLA');

      const trades = (await request(server).get('/trades').set('Authorization', AUTH_A).expect(200))
        .body as TradeResponse[];

      expect(trades.every((t) => t.userId === USER_A_ID)).toBe(true);
      expect(trades).toHaveLength(2);
      expect(trades.find((t) => t.symbol === 'TSLA')).toBeUndefined();
    });

    it("never leaks another user's trades regardless of volume", async () => {
      for (const symbol of ['AAPL', 'MSFT', 'GOOG', 'AMZN', 'META']) {
        await seedTrade(tradeModel, USER_B_ID, symbol);
      }

      const trades = (await request(server).get('/trades').set('Authorization', AUTH_A).expect(200))
        .body as TradeResponse[];

      expect(trades).toHaveLength(0);
    });

    it('returns an empty array when the user has no trades', async () => {
      const trades = (await request(server).get('/trades').set('Authorization', AUTH_A).expect(200))
        .body as TradeResponse[];

      expect(trades).toEqual([]);
    });

    it('isolation is bidirectional — each user sees only their own trades', async () => {
      await seedTrade(tradeModel, USER_A_ID, 'AAPL');
      await seedTrade(tradeModel, USER_B_ID, 'TSLA');

      const tradesB = (
        await request(server).get('/trades').set('Authorization', AUTH_B).expect(200)
      ).body as TradeResponse[];

      expect(tradesB.every((t) => t.userId === USER_B_ID)).toBe(true);
      expect(tradesB.find((t) => t.symbol === 'AAPL')).toBeUndefined();
    });

    it('returns trades in descending executedAt order', async () => {
      const now = Date.now();
      await tradeModel.create({
        portfolioId: 'p1',
        userId: USER_A_ID,
        symbol: 'AAPL',
        type: 'buy',
        shares: 1,
        price: 100,
        totalAmount: 100,
        executedAt: new Date(now - 2000),
      });
      await tradeModel.create({
        portfolioId: 'p1',
        userId: USER_A_ID,
        symbol: 'MSFT',
        type: 'buy',
        shares: 1,
        price: 100,
        totalAmount: 100,
        executedAt: new Date(now),
      });

      const trades = (await request(server).get('/trades').set('Authorization', AUTH_A).expect(200))
        .body as TradeResponse[];

      expect(trades[0]?.symbol).toBe('MSFT');
      expect(trades[1]?.symbol).toBe('AAPL');
    });
  });
});
