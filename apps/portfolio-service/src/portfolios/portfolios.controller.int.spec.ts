import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../app.module';
import { KafkaConsumerService } from '../kafka/kafka-consumer.service';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { Trade } from '../trades/schemas/trade.schema';
import { Portfolio } from './schemas/portfolio.schema';

interface StockHolding {
  symbol: string;
  shares: number;
  avgCostBasis: number;
  currentValue?: number;
}

interface PortfolioResponse {
  id: string;
  userId: string;
  name: string;
  stocks: StockHolding[];
  totalValue?: number;
  createdAt: string;
  updatedAt: string;
}

function makeTestJwt(sub: string, email: string): string {
  const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, email, iat: Date.now() })).toString('base64url');
  return `${header}.${payload}.test-signature`;
}

const USER_ID = 'int-test-user-1';
const USER_EMAIL = 'int-test@example.com';
const OTHER_USER_ID = 'int-test-user-2';
const AUTH = `Bearer ${makeTestJwt(USER_ID, USER_EMAIL)}`;

describe('PortfoliosController (integration)', () => {
  let app: INestApplication;
  let server: Server;
  let portfolioModel: Model<Portfolio>;
  let tradeModel: Model<Trade>;

  const kafkaProducerMock = {
    emitPortfolioEvent: jest.fn().mockResolvedValue(undefined),
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
  };
  const kafkaConsumerMock = {
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(KafkaProducerService)
      .useValue(kafkaProducerMock)
      .overrideProvider(KafkaConsumerService)
      .useValue(kafkaConsumerMock)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    server = app.getHttpServer() as Server;
    portfolioModel = moduleRef.get(getModelToken(Portfolio.name));
    tradeModel = moduleRef.get(getModelToken(Trade.name));
  });

  afterEach(async () => {
    await portfolioModel.deleteMany({ userId: { $in: [USER_ID, OTHER_USER_ID] } });
    await tradeModel.deleteMany({ userId: { $in: [USER_ID, OTHER_USER_ID] } });
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /portfolios', () => {
    it('creates a portfolio and writes it to MongoDB', async () => {
      const body = (
        await request(server)
          .post('/portfolios')
          .set('Authorization', AUTH)
          .send({ name: 'My Tech Portfolio' })
          .expect(201)
      ).body as PortfolioResponse;

      expect(body.id).toBeTruthy();
      expect(body.name).toBe('My Tech Portfolio');
      expect(body.userId).toBe(USER_ID);
      expect(body.stocks).toEqual([]);

      const doc = await portfolioModel.findById(body.id).lean<Portfolio>().exec();
      expect(doc).not.toBeNull();
      expect(doc!.name).toBe('My Tech Portfolio');
    });

    it('emits a portfolio_created Kafka event', async () => {
      await request(server)
        .post('/portfolios')
        .set('Authorization', AUTH)
        .send({ name: 'Event Portfolio' })
        .expect(201);

      expect(kafkaProducerMock.emitPortfolioEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'portfolio_created', userId: USER_ID }),
      );
    });

    it('returns 401 without an Authorization header', async () => {
      await request(server).post('/portfolios').send({ name: 'Unauth' }).expect(401);
    });

    it('returns 400 for a missing name', async () => {
      await request(server).post('/portfolios').set('Authorization', AUTH).send({}).expect(400);
    });
  });

  describe('GET /portfolios', () => {
    it('returns only portfolios belonging to the requesting user', async () => {
      await portfolioModel.create({ userId: USER_ID, name: 'Mine', stocks: [] });
      await portfolioModel.create({ userId: OTHER_USER_ID, name: 'Theirs', stocks: [] });

      const portfolios = (
        await request(server).get('/portfolios').set('Authorization', AUTH).expect(200)
      ).body as PortfolioResponse[];

      expect(portfolios.every((p) => p.userId === USER_ID)).toBe(true);
      expect(portfolios.find((p) => p.name === 'Mine')).toBeTruthy();
      expect(portfolios.find((p) => p.name === 'Theirs')).toBeUndefined();
    });

    it('returns an empty array when the user has no portfolios', async () => {
      const portfolios = (
        await request(server).get('/portfolios').set('Authorization', AUTH).expect(200)
      ).body as PortfolioResponse[];

      expect(portfolios).toEqual([]);
    });
  });

  describe('GET /portfolios/:id', () => {
    it('returns the portfolio when it belongs to the requesting user', async () => {
      const doc = await portfolioModel.create({ userId: USER_ID, name: 'Fetch Me', stocks: [] });

      const body = (
        await request(server)
          .get(`/portfolios/${doc._id.toString()}`)
          .set('Authorization', AUTH)
          .expect(200)
      ).body as PortfolioResponse;

      expect(body.name).toBe('Fetch Me');
    });

    it('returns 403 when the portfolio belongs to another user', async () => {
      const doc = await portfolioModel.create({ userId: OTHER_USER_ID, name: 'Not Mine', stocks: [] });
      await request(server)
        .get(`/portfolios/${doc._id.toString()}`)
        .set('Authorization', AUTH)
        .expect(403);
    });

    it('returns 404 for a non-existent portfolio', async () => {
      await request(server).get('/portfolios/000000000000000000000001').set('Authorization', AUTH).expect(404);
    });
  });

  describe('POST /portfolios/:id/stocks', () => {
    it('adds a stock holding, records a trade, and emits stock_added', async () => {
      const doc = await portfolioModel.create({ userId: USER_ID, name: 'Trading Portfolio', stocks: [] });
      const portfolioId = doc._id.toString();

      const body = (
        await request(server)
          .post(`/portfolios/${portfolioId}/stocks`)
          .set('Authorization', AUTH)
          .send({ symbol: 'AAPL', shares: 10, price: 150 })
          .expect(201)
      ).body as PortfolioResponse;

      const holding = body.stocks.find((s) => s.symbol === 'AAPL');
      expect(holding).toBeTruthy();
      expect(holding!.shares).toBe(10);
      expect(holding!.avgCostBasis).toBe(150);

      const trade = await tradeModel.findOne({ portfolioId, symbol: 'AAPL' }).lean<Trade>().exec();
      expect(trade).not.toBeNull();
      expect(trade!.type).toBe('buy');
      expect(trade!.shares).toBe(10);

      expect(kafkaProducerMock.emitPortfolioEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'stock_added', userId: USER_ID }),
      );
    });

    it('averages cost basis when the same symbol is added again', async () => {
      const doc = await portfolioModel.create({ userId: USER_ID, name: 'Avg Cost Portfolio', stocks: [] });
      const id = doc._id.toString();

      await request(server)
        .post(`/portfolios/${id}/stocks`)
        .set('Authorization', AUTH)
        .send({ symbol: 'MSFT', shares: 10, price: 100 });

      const body = (
        await request(server)
          .post(`/portfolios/${id}/stocks`)
          .set('Authorization', AUTH)
          .send({ symbol: 'MSFT', shares: 10, price: 120 })
          .expect(201)
      ).body as PortfolioResponse;

      const holding = body.stocks.find((s) => s.symbol === 'MSFT');
      expect(holding!.shares).toBe(20);
      expect(holding!.avgCostBasis).toBe(110); // (10*100 + 10*120) / 20
    });

    it('returns 403 when the portfolio belongs to another user', async () => {
      const doc = await portfolioModel.create({ userId: OTHER_USER_ID, name: 'Not Mine', stocks: [] });
      await request(server)
        .post(`/portfolios/${doc._id.toString()}/stocks`)
        .set('Authorization', AUTH)
        .send({ symbol: 'TSLA', shares: 5, price: 200 })
        .expect(403);
    });
  });

  describe('PUT /portfolios/:id', () => {
    it('renames the portfolio', async () => {
      const doc = await portfolioModel.create({ userId: USER_ID, name: 'Old Name', stocks: [] });

      const body = (
        await request(server)
          .put(`/portfolios/${doc._id.toString()}`)
          .set('Authorization', AUTH)
          .send({ name: 'New Name' })
          .expect(200)
      ).body as PortfolioResponse;

      expect(body.name).toBe('New Name');
    });
  });

  describe('DELETE /portfolios/:id', () => {
    it('removes the portfolio from MongoDB', async () => {
      const doc = await portfolioModel.create({ userId: USER_ID, name: 'To Delete', stocks: [] });
      const id = doc._id.toString();

      await request(server).delete(`/portfolios/${id}`).set('Authorization', AUTH).expect(204);

      const found = await portfolioModel.findById(id).exec();
      expect(found).toBeNull();
    });

    it('returns 404 when deleting a non-existent portfolio', async () => {
      await request(server)
        .delete('/portfolios/000000000000000000000001')
        .set('Authorization', AUTH)
        .expect(404);
    });
  });
});
