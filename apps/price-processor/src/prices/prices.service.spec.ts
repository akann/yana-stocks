import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import type { ProcessedPriceMessage, RawPriceMessage } from '@yana-stocks/shared-types';
import { KAFKA_TOPICS } from '@yana-stocks/kafka-client';
import { RedisService } from '../redis/redis.service';
import { KafkaProducerService } from './kafka-producer.service';
import { POLYGON_HTTP, PricesService } from './prices.service';
import { PriceBar } from './schemas/price-bar.schema';

// ── fixtures ──────────────────────────────────────────────────────────────

const mockBar: PriceBar = {
  symbol: 'AAPL',
  timestamp: new Date('2024-01-01T10:30:00.000Z'),
  open: 150.0,
  high: 151.5,
  low: 149.5,
  close: 151.0,
  volume: 1500,
  interval: '1m',
};

const rawMsg: RawPriceMessage = {
  symbol: 'AAPL',
  open: 150.0,
  high: 151.5,
  low: 149.5,
  close: 151.0,
  volume: 500,
  timestamp: '2024-01-01T10:30:00.000Z',
};

// Polygon REST API response shapes (axios wraps body in { data: ... })
const massiveAggSuccess = {
  ticker: 'SHOP',
  results: [
    {
      t: new Date('2024-01-02T14:30:00Z').getTime(),
      o: 150,
      h: 151,
      l: 149.5,
      c: 150.5,
      v: 10_000,
    },
  ],
};
const massiveAggEmpty = { ticker: 'SHOP', results: [] };

const massiveSnapSuccess = {
  ticker: {
    day: { c: 151.0, v: 5_000_000 },
    prevDay: { c: 148.0 },
  },
};
const massiveSnapEmpty = { ticker: null };

// ── module factory ────────────────────────────────────────────────────────

interface Fixture {
  service: PricesService;
  model: { findOneAndUpdate: jest.Mock; find: jest.Mock; bulkWrite: jest.Mock };
  redisGet: jest.Mock;
  redisSetex: jest.Mock;
  producer: { emit: jest.Mock };
  mockGet: jest.Mock;
}

function makeFindChain(result: PriceBar[] = []) {
  const exec = jest.fn().mockResolvedValue(result);
  return {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec,
  };
}

async function buildModule(): Promise<Fixture> {
  const mockGet = jest.fn();
  const model = {
    findOneAndUpdate: jest.fn().mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve(mockBar) }),
    }),
    find: jest.fn().mockReturnValue(makeFindChain()),
    bulkWrite: jest.fn().mockResolvedValue({ ok: 1 }),
  };
  const redisGet = jest.fn().mockResolvedValue(null);
  const redisSetex = jest.fn().mockResolvedValue(undefined);
  const emit = jest.fn().mockResolvedValue(undefined);

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      PricesService,
      { provide: getModelToken(PriceBar.name), useValue: model },
      {
        provide: RedisService,
        useValue: { get: redisGet, setex: redisSetex } satisfies Partial<RedisService>,
      },
      { provide: KafkaProducerService, useValue: { emit } satisfies Partial<KafkaProducerService> },
      {
        provide: ConfigService,
        useValue: {
          get: jest.fn().mockImplementation((key: string) => {
            if (key === 'massive.apiKey') return 'test-key';
            return '';
          }),
        },
      },
      { provide: POLYGON_HTTP, useValue: { get: mockGet } },
    ],
  }).compile();

  return {
    service: module.get<PricesService>(PricesService),
    model,
    redisGet,
    redisSetex,
    producer: { emit },
    mockGet,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────

describe('PricesService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── process ──────────────────────────────────────────────────────────────

  describe('process', () => {
    let service: PricesService;
    let model: Fixture['model'];
    let redisSetex: jest.Mock;
    let producer: Fixture['producer'];

    beforeEach(async () => {
      ({ service, model, redisSetex, producer } = await buildModule());
    });

    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('upserts the complete OHLCV bar using $setOnInsert', async () => {
      await service.process(rawMsg);

      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ symbol: 'AAPL', interval: '1m' }),
        expect.objectContaining({
          $setOnInsert: expect.objectContaining({
            open: 150.0,
            high: 151.5,
            low: 149.5,
            close: 151.0,
            volume: 500,
          }) as unknown,
        }),
        { upsert: true, new: true },
      );
    });

    it('does not use $max/$min/$set/$inc operators (tick aggregation is gone)', async () => {
      await service.process(rawMsg);

      const [, update] = model.findOneAndUpdate.mock.calls[0] as [unknown, Record<string, unknown>];
      expect(update).not.toHaveProperty('$max');
      expect(update).not.toHaveProperty('$min');
      expect(update).not.toHaveProperty('$inc');
    });

    it('caches msg.close (not msg.price) in Redis with 5s TTL', async () => {
      await service.process(rawMsg);
      expect(redisSetex).toHaveBeenCalledWith('price:latest:AAPL', 5, '151');
    });

    it('emits ProcessedPriceMessage with price = msg.close', async () => {
      await service.process(rawMsg);

      expect(producer.emit).toHaveBeenCalledWith(
        KAFKA_TOPICS.PRICES_PROCESSED,
        'AAPL',
        expect.objectContaining<Partial<ProcessedPriceMessage>>({
          symbol: 'AAPL',
          price: 151.0,
          ohlcv: expect.objectContaining({
            open: 150.0,
            close: 151.0,
          }) as ProcessedPriceMessage['ohlcv'],
        }),
      );
    });
  });

  // ── getHistory ────────────────────────────────────────────────────────────

  describe('getHistory', () => {
    it('returns DB bars without fetching when hist:fetched flag is set', async () => {
      const { service, redisGet, mockGet } = await buildModule();
      redisGet.mockImplementation((key: string) =>
        Promise.resolve(key === 'hist:fetched:SHOP:1m' ? '1' : null),
      );

      await service.getHistory('SHOP', { limit: 60, interval: '1m' });

      expect(mockGet).not.toHaveBeenCalled();
    });

    it('calls Polygon aggregates endpoint on cache miss', async () => {
      const { service, mockGet } = await buildModule();
      mockGet.mockResolvedValue({ data: massiveAggEmpty });

      await service.getHistory('SHOP', { limit: 60, interval: '1m' });

      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('/v2/aggs/ticker/SHOP/range/1/minute/'),
        expect.objectContaining({
          params: expect.objectContaining({ adjusted: true, limit: 50000 }) as unknown,
        }),
      );
    });

    it('uses timespan=day for 1d interval', async () => {
      const { service, mockGet } = await buildModule();
      mockGet.mockResolvedValue({ data: massiveAggEmpty });

      await service.getHistory('SHOP', { limit: 21, interval: '1d' });

      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('/v2/aggs/ticker/SHOP/range/1/day/'),
        expect.anything(),
      );
    });

    it('stores bars and sets hist:fetched flag on success', async () => {
      const { service, model, redisSetex, mockGet } = await buildModule();
      mockGet.mockResolvedValue({ data: massiveAggSuccess });

      await service.getHistory('SHOP', { limit: 60, interval: '1m' });

      expect(model.bulkWrite).toHaveBeenCalled();
      expect(redisSetex).toHaveBeenCalledWith('hist:fetched:SHOP:1m', 900, '1');
    });

    it('sets no-data flag with 24h TTL when Massive returns empty results', async () => {
      const { service, redisSetex, mockGet } = await buildModule();
      mockGet.mockResolvedValue({ data: massiveAggEmpty });

      await service.getHistory('SHOP', { limit: 60, interval: '1m' });

      expect(redisSetex).toHaveBeenCalledWith('hist:no-data:SHOP:1m', 86400, '1');
    });

    it('does not set no-data flag when Massive throws (network error should not poison DB fallback)', async () => {
      const { service, redisSetex, mockGet } = await buildModule();
      mockGet.mockRejectedValue(new Error('network error'));

      await service.getHistory('SHOP', { limit: 60, interval: '1m' });

      expect(redisSetex).not.toHaveBeenCalledWith('hist:no-data:SHOP:1m', expect.anything(), '1');
    });

    it('skips fetch when no-data flag is already set', async () => {
      const { service, redisGet, mockGet } = await buildModule();
      redisGet.mockImplementation((key: string) =>
        Promise.resolve(key === 'hist:no-data:SHOP:1m' ? '1' : null),
      );

      await service.getHistory('SHOP', { limit: 60, interval: '1m' });

      expect(mockGet).not.toHaveBeenCalled();
    });

    it('deduplicates bars with the same YYYY-MM-DD for 1d interval, keeping highest UTC', async () => {
      const { service, model, redisGet } = await buildModule();
      // Simulate two MongoDB docs for the same trading day at different UTC hours
      const dupBars: PriceBar[] = [
        { ...mockBar, interval: '1d', timestamp: new Date('2024-01-02T04:00:00.000Z'), close: 155 },
        { ...mockBar, interval: '1d', timestamp: new Date('2024-01-02T00:00:00.000Z'), close: 150 },
      ];
      model.find.mockReturnValue(makeFindChain(dupBars));
      redisGet.mockImplementation((key: string) =>
        Promise.resolve(key === 'hist:fetched:SHOP:1d' ? '1' : null),
      );

      const result = await service.getHistory('SHOP', { limit: 21, interval: '1d' });

      expect(result).toHaveLength(1);
      // Bars are sorted DESC so T04 comes first → T04 bar is kept
      expect(result[0]?.close).toBe(155);
    });

    it('does not deduplicate bars for 1m interval', async () => {
      const { service, model, redisGet } = await buildModule();
      const bars: PriceBar[] = [
        { ...mockBar, interval: '1m', timestamp: new Date('2024-01-02T10:31:00.000Z') },
        { ...mockBar, interval: '1m', timestamp: new Date('2024-01-02T10:30:00.000Z') },
      ];
      model.find.mockReturnValue(makeFindChain(bars));
      redisGet.mockImplementation((key: string) =>
        Promise.resolve(key === 'hist:fetched:SHOP:1m' ? '1' : null),
      );

      const result = await service.getHistory('SHOP', { limit: 60, interval: '1m' });

      expect(result).toHaveLength(2);
    });

    it('1d and 1m freshness flags are independent', async () => {
      const { service, redisGet, mockGet } = await buildModule();
      mockGet.mockResolvedValue({ data: massiveAggEmpty });
      redisGet.mockImplementation((key: string) =>
        Promise.resolve(key === 'hist:fetched:SHOP:1d' ? '1' : null),
      );

      await service.getHistory('SHOP', { limit: 60, interval: '1m' });

      expect(mockGet).toHaveBeenCalled();
    });
  });

  // ── getQuote ──────────────────────────────────────────────────────────────

  describe('getQuote', () => {
    it('returns cached entry from Redis without calling Massive', async () => {
      const { service, redisGet, mockGet } = await buildModule();
      const cached = JSON.stringify({
        price: 150,
        prevPrice: 148,
        change: 2,
        changePercent: 1.35,
        volume: 1000,
        timestamp: '2024-01-01T10:00:00Z',
      });
      redisGet.mockResolvedValue(cached);

      const result = await service.getQuote('AAPL');

      expect(mockGet).not.toHaveBeenCalled();
      expect(result?.price).toBe(150);
    });

    it('calls Polygon snapshot endpoint and maps the response on cache miss', async () => {
      const { service, redisSetex, mockGet } = await buildModule();
      mockGet.mockResolvedValue({ data: massiveSnapSuccess });

      const result = await service.getQuote('AAPL');

      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('/v2/snapshot/locale/us/markets/stocks/tickers/AAPL'),
        expect.anything(),
      );
      expect(result?.price).toBe(151.0);
      expect(result?.prevPrice).toBe(148.0);
      expect(result?.change).toBeCloseTo(3.0);
      expect(redisSetex).toHaveBeenCalledWith('price:quote:AAPL', 900, expect.any(String));
    });

    it('returns null when Massive snapshot has no data', async () => {
      const { service, mockGet } = await buildModule();
      mockGet.mockResolvedValue({ data: massiveSnapEmpty });

      const result = await service.getQuote('AAPL');

      expect(result).toBeNull();
    });

    it('returns null when Massive throws', async () => {
      const { service, mockGet } = await buildModule();
      mockGet.mockRejectedValue(new Error('timeout'));

      const result = await service.getQuote('AAPL');

      expect(result).toBeNull();
    });
  });
});
