import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../app.module';
import { KafkaConsumerService } from '../kafka/kafka-consumer.service';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { Watchlist } from './schemas/watchlist.schema';

interface WatchlistResponse {
  id: string;
  userId: string;
  name: string;
  symbols: string[];
  createdAt: string;
  updatedAt: string;
}

function makeTestJwt(sub: string, email: string): string {
  const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, email, iat: Date.now() })).toString(
    'base64url',
  );
  return `${header}.${payload}.test-signature`;
}

const USER_ID = 'wl-int-user-1';
const USER_EMAIL = 'wl-int@example.com';
const OTHER_USER_ID = 'wl-int-user-2';
const AUTH = `Bearer ${makeTestJwt(USER_ID, USER_EMAIL)}`;
const OTHER_AUTH = `Bearer ${makeTestJwt(OTHER_USER_ID, 'other@example.com')}`;

describe('WatchlistsController (integration)', () => {
  let app: INestApplication;
  let server: Server;
  let watchlistModel: Model<Watchlist>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(KafkaProducerService)
      .useValue({
        emitPortfolioEvent: jest.fn().mockResolvedValue(undefined),
        onModuleInit: jest.fn(),
        onModuleDestroy: jest.fn(),
      })
      .overrideProvider(KafkaConsumerService)
      .useValue({ onModuleInit: jest.fn(), onModuleDestroy: jest.fn() })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    server = app.getHttpServer() as Server;
    watchlistModel = moduleRef.get(getModelToken(Watchlist.name));
  });

  afterEach(async () => {
    await watchlistModel.deleteMany({ userId: { $in: [USER_ID, OTHER_USER_ID] } });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /watchlists', () => {
    it('creates a watchlist and persists it to MongoDB', async () => {
      const body = (
        await request(server)
          .post('/watchlists')
          .set('Authorization', AUTH)
          .send({ name: 'Tech Stocks', symbols: ['AAPL', 'MSFT'] })
          .expect(201)
      ).body as WatchlistResponse;

      expect(body.id).toBeTruthy();
      expect(body.userId).toBe(USER_ID);
      expect(body.name).toBe('Tech Stocks');
      expect(body.symbols).toEqual(['AAPL', 'MSFT']);

      const doc = await watchlistModel.findById(body.id).lean<Watchlist>().exec();
      expect(doc).not.toBeNull();
    });

    it('returns 401 without an Authorization header', async () => {
      await request(server).post('/watchlists').send({ name: 'Unauth' }).expect(401);
    });

    it('returns 400 for a missing name', async () => {
      await request(server).post('/watchlists').set('Authorization', AUTH).send({}).expect(400);
    });
  });

  describe('GET /watchlists', () => {
    it('returns only watchlists belonging to the requesting user', async () => {
      await watchlistModel.create({ userId: USER_ID, name: 'Mine', symbols: [] });
      await watchlistModel.create({ userId: OTHER_USER_ID, name: 'Theirs', symbols: [] });

      const watchlists = (
        await request(server).get('/watchlists').set('Authorization', AUTH).expect(200)
      ).body as WatchlistResponse[];

      expect(watchlists.every((w) => w.userId === USER_ID)).toBe(true);
      expect(watchlists.find((w) => w.name === 'Mine')).toBeTruthy();
      expect(watchlists.find((w) => w.name === 'Theirs')).toBeUndefined();
    });
  });

  describe('GET /watchlists/:id — cross-tenant isolation', () => {
    it('returns the watchlist when it belongs to the requesting user', async () => {
      const doc = await watchlistModel.create({ userId: USER_ID, name: 'Fetch Me', symbols: [] });

      const body = (
        await request(server)
          .get(`/watchlists/${doc._id.toString()}`)
          .set('Authorization', AUTH)
          .expect(200)
      ).body as WatchlistResponse;

      expect(body.name).toBe('Fetch Me');
    });

    it('returns 404 when the watchlist belongs to another user', async () => {
      const doc = await watchlistModel.create({
        userId: OTHER_USER_ID,
        name: 'Not Mine',
        symbols: [],
      });
      await request(server)
        .get(`/watchlists/${doc._id.toString()}`)
        .set('Authorization', AUTH)
        .expect(404);
    });

    it('returns 404 for a non-existent watchlist', async () => {
      await request(server)
        .get('/watchlists/000000000000000000000001')
        .set('Authorization', AUTH)
        .expect(404);
    });
  });

  describe('POST /watchlists/:id/symbols — cross-tenant isolation', () => {
    it('adds a symbol to own watchlist', async () => {
      const doc = await watchlistModel.create({ userId: USER_ID, name: 'Mine', symbols: [] });

      const body = (
        await request(server)
          .post(`/watchlists/${doc._id.toString()}/symbols`)
          .set('Authorization', AUTH)
          .send({ symbol: 'tsla' })
          .expect(201)
      ).body as WatchlistResponse;

      expect(body.symbols).toContain('TSLA');
    });

    it('returns 404 when the watchlist belongs to another user', async () => {
      const doc = await watchlistModel.create({
        userId: OTHER_USER_ID,
        name: 'Not Mine',
        symbols: [],
      });
      await request(server)
        .post(`/watchlists/${doc._id.toString()}/symbols`)
        .set('Authorization', AUTH)
        .send({ symbol: 'TSLA' })
        .expect(404);

      const unchanged = await watchlistModel.findById(doc._id).lean<Watchlist>().exec();
      expect(unchanged!.symbols).toEqual([]);
    });

    it('returns 400 for a missing symbol', async () => {
      const doc = await watchlistModel.create({ userId: USER_ID, name: 'Mine', symbols: [] });
      await request(server)
        .post(`/watchlists/${doc._id.toString()}/symbols`)
        .set('Authorization', AUTH)
        .send({})
        .expect(400);
    });
  });

  describe('DELETE /watchlists/:id/symbols/:symbol — cross-tenant isolation', () => {
    it('removes a symbol from own watchlist', async () => {
      const doc = await watchlistModel.create({
        userId: USER_ID,
        name: 'Mine',
        symbols: ['AAPL', 'MSFT'],
      });

      const body = (
        await request(server)
          .delete(`/watchlists/${doc._id.toString()}/symbols/AAPL`)
          .set('Authorization', AUTH)
          .expect(200)
      ).body as WatchlistResponse;

      expect(body.symbols).not.toContain('AAPL');
      expect(body.symbols).toContain('MSFT');
    });

    it('returns 404 when the watchlist belongs to another user', async () => {
      const doc = await watchlistModel.create({
        userId: OTHER_USER_ID,
        name: 'Not Mine',
        symbols: ['AAPL'],
      });
      await request(server)
        .delete(`/watchlists/${doc._id.toString()}/symbols/AAPL`)
        .set('Authorization', AUTH)
        .expect(404);

      const unchanged = await watchlistModel.findById(doc._id).lean<Watchlist>().exec();
      expect(unchanged!.symbols).toContain('AAPL');
    });
  });

  describe('DELETE /watchlists/:id — cross-tenant isolation', () => {
    it('deletes own watchlist', async () => {
      const doc = await watchlistModel.create({ userId: USER_ID, name: 'To Delete', symbols: [] });
      const id = doc._id.toString();

      await request(server).delete(`/watchlists/${id}`).set('Authorization', AUTH).expect(204);

      const found = await watchlistModel.findById(id).exec();
      expect(found).toBeNull();
    });

    it('returns 404 when the watchlist belongs to another user', async () => {
      const doc = await watchlistModel.create({
        userId: OTHER_USER_ID,
        name: 'Not Mine',
        symbols: [],
      });
      await request(server)
        .delete(`/watchlists/${doc._id.toString()}`)
        .set('Authorization', AUTH)
        .expect(404);

      const stillExists = await watchlistModel.findById(doc._id).lean().exec();
      expect(stillExists).not.toBeNull();
    });

    it('returns 404 for a non-existent watchlist', async () => {
      await request(server)
        .delete('/watchlists/000000000000000000000001')
        .set('Authorization', AUTH)
        .expect(404);
    });
  });

  describe('Two users — data isolation end-to-end', () => {
    it('each user sees only their own watchlists', async () => {
      await request(server)
        .post('/watchlists')
        .set('Authorization', AUTH)
        .send({ name: 'User A list' })
        .expect(201);

      await request(server)
        .post('/watchlists')
        .set('Authorization', OTHER_AUTH)
        .send({ name: 'User B list' })
        .expect(201);

      const listA = (
        await request(server).get('/watchlists').set('Authorization', AUTH).expect(200)
      ).body as WatchlistResponse[];

      const listB = (
        await request(server).get('/watchlists').set('Authorization', OTHER_AUTH).expect(200)
      ).body as WatchlistResponse[];

      expect(listA.every((w) => w.userId === USER_ID)).toBe(true);
      expect(listA.find((w) => w.name === 'User B list')).toBeUndefined();
      expect(listB.every((w) => w.userId === OTHER_USER_ID)).toBe(true);
      expect(listB.find((w) => w.name === 'User A list')).toBeUndefined();
    });
  });
});
