import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { RawPriceMessage } from '@yana-stocks/shared-types';
import Redis from 'ioredis';
import { Model } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../app.module';
import { KafkaConsumerService } from './kafka-consumer.service';
import { KafkaProducerService } from './kafka-producer.service';
import { PricesService } from './prices.service';
import { PriceBar } from './schemas/price-bar.schema';

interface OHLCVBar {
  symbol: string;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  interval: string;
}

const SYM = 'INT_TEST_SYM';

describe('PricesService / PricesController (integration)', () => {
  let app: INestApplication;
  let server: Server;
  let pricesService: PricesService;
  let priceBarModel: Model<PriceBar>;
  let rawRedis: Redis;

  const kafkaConsumerMock = {
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
  };
  const kafkaProducerMock = {
    emit: jest.fn().mockResolvedValue(undefined),
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(KafkaConsumerService)
      .useValue(kafkaConsumerMock)
      .overrideProvider(KafkaProducerService)
      .useValue(kafkaProducerMock)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    server = app.getHttpServer() as Server;
    pricesService = moduleRef.get(PricesService);
    priceBarModel = moduleRef.get(getModelToken(PriceBar.name));
    rawRedis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379');
  });

  afterEach(async () => {
    await priceBarModel.deleteMany({ symbol: SYM });
    await rawRedis.del(`price:latest:${SYM}`);
    await rawRedis.del(`hist:fetched:${SYM}:1m`);
    await rawRedis.del(`hist:fetched:${SYM}:1d`);
    await rawRedis.del(`hist:no-data-min:${SYM}`);
    await rawRedis.del(`hist:no-data:${SYM}`);
    jest.clearAllMocks();
  });

  afterAll(async () => {
    rawRedis.disconnect();
    await app.close();
  });

  const rawMsg = (price: number, ts?: string): RawPriceMessage => ({
    symbol: SYM,
    price,
    bid: price - 0.01,
    ask: price + 0.01,
    volume: 500,
    timestamp: ts ?? new Date().toISOString(),
  });

  describe('process()', () => {
    it('upserts an OHLCV bar document in MongoDB', async () => {
      await pricesService.process(rawMsg(150.0));

      const bar = await priceBarModel.findOne({ symbol: SYM }).lean<PriceBar>().exec();
      expect(bar).not.toBeNull();
      expect(bar!.symbol).toBe(SYM);
      expect(bar!.open).toBe(150.0);
      expect(bar!.close).toBe(150.0);
      expect(bar!.high).toBe(150.0);
      expect(bar!.low).toBe(150.0);
      expect(bar!.volume).toBe(500);
    });

    it('accumulates volume and updates high/low/close across ticks in the same minute', async () => {
      const baseTs = '2025-01-01T10:00:30.000Z';
      await pricesService.process(rawMsg(100.0, baseTs));
      await pricesService.process(rawMsg(105.0, '2025-01-01T10:00:45.000Z'));
      await pricesService.process(rawMsg(98.0, '2025-01-01T10:00:55.000Z'));

      const bar = await priceBarModel.findOne({ symbol: SYM }).lean<PriceBar>().exec();
      expect(bar!.open).toBe(100.0); // $setOnInsert — first tick wins
      expect(bar!.high).toBe(105.0);
      expect(bar!.low).toBe(98.0);
      expect(bar!.close).toBe(98.0); // last tick
      expect(bar!.volume).toBe(1500); // 500 * 3
    });

    it('stores the timestamp truncated to the minute', async () => {
      await pricesService.process(rawMsg(150.0, '2025-06-01T14:37:22.500Z'));

      const bar = await priceBarModel.findOne({ symbol: SYM }).lean<PriceBar>().exec();
      expect(bar!.timestamp.getSeconds()).toBe(0);
      expect(bar!.timestamp.getMilliseconds()).toBe(0);
    });

    it('caches the latest price in Redis', async () => {
      await pricesService.process(rawMsg(151.5));

      const cached = await rawRedis.get(`price:latest:${SYM}`);
      expect(cached).toBe('151.5');
    });

    it('sets a 5-second TTL on the Redis cache key', async () => {
      await pricesService.process(rawMsg(200.0));

      const ttl = await rawRedis.ttl(`price:latest:${SYM}`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(5);
    });

    it('calls the Kafka producer with the processed message', async () => {
      await pricesService.process(rawMsg(160.0));

      expect(kafkaProducerMock.emit).toHaveBeenCalledTimes(1);
      expect(kafkaProducerMock.emit).toHaveBeenCalledWith(
        'stocks.prices.processed',
        SYM,
        expect.objectContaining({ symbol: SYM, price: 160.0 }),
      );
    });
  });

  describe('GET /prices/:symbol/history', () => {
    beforeEach(async () => {
      // Mark data as fresh so getHistory skips the on-demand external fetch
      // for this non-predefined test symbol.
      await rawRedis.setex(`hist:fetched:${SYM}:1m`, 900, '1');
    });

    it('returns OHLCV bars seeded directly into MongoDB', async () => {
      await priceBarModel.create({
        symbol: SYM,
        timestamp: new Date('2025-01-01T10:00:00.000Z'),
        open: 100,
        high: 110,
        low: 95,
        close: 105,
        volume: 3000,
      });

      const bars = (await request(server).get(`/prices/${SYM}/history`).expect(200))
        .body as OHLCVBar[];

      expect(bars).toHaveLength(1);
      expect(bars[0]!.symbol).toBe(SYM);
      expect(bars[0]!.open).toBe(100);
      expect(bars[0]!.high).toBe(110);
      expect(bars[0]!.low).toBe(95);
      expect(bars[0]!.close).toBe(105);
      expect(bars[0]!.interval).toBe('1m');
    });

    it('returns bars sorted by timestamp descending', async () => {
      await priceBarModel.insertMany([
        {
          symbol: SYM,
          timestamp: new Date('2025-01-01T10:00:00Z'),
          open: 100,
          high: 100,
          low: 100,
          close: 100,
          volume: 1,
        },
        {
          symbol: SYM,
          timestamp: new Date('2025-01-01T10:01:00Z'),
          open: 102,
          high: 102,
          low: 102,
          close: 102,
          volume: 1,
        },
        {
          symbol: SYM,
          timestamp: new Date('2025-01-01T10:02:00Z'),
          open: 104,
          high: 104,
          low: 104,
          close: 104,
          volume: 1,
        },
      ]);

      const bars = (await request(server).get(`/prices/${SYM}/history?limit=3`).expect(200))
        .body as OHLCVBar[];

      expect(bars.map((b) => b.close)).toEqual([104, 102, 100]); // newest first
    });

    it('returns an empty array when no bars exist', async () => {
      const bars = (await request(server).get('/prices/DOESNOTEXIST_XYZ/history').expect(200))
        .body as OHLCVBar[];

      expect(bars).toEqual([]);
    });

    it('respects the limit query parameter', async () => {
      await priceBarModel.insertMany(
        Array.from({ length: 5 }, (_, i) => ({
          symbol: SYM,
          timestamp: new Date(Date.now() + i * 60_000),
          open: 100 + i,
          high: 100 + i,
          low: 100 + i,
          close: 100 + i,
          volume: 1,
        })),
      );

      const bars = (await request(server).get(`/prices/${SYM}/history?limit=2`).expect(200))
        .body as OHLCVBar[];

      expect(bars).toHaveLength(2);
    });
  });
});
