// ── yahoo-finance2 mock ──────────────────────────────────────────────────
// The chart/quote mocks live inside the factory so no external variable
// is referenced across the jest.mock hoisting boundary. They are attached to
// the constructor so tests can reach them via MockYahooFinance._chart / _quote.
jest.mock('yahoo-finance2', () => {
  const chart = jest.fn();
  const quote = jest.fn();
  return {
    __esModule: true,
    default: Object.assign(
      jest.fn(() => ({ chart, quote })),
      { _chart: chart, _quote: quote },
    ),
  };
});

import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import type { ProcessedPriceMessage, RawPriceMessage } from '@yana-stocks/shared-types';
import { KAFKA_TOPICS } from '@yana-stocks/kafka-client';
import YahooFinance from 'yahoo-finance2';
import { RedisService } from '../redis/redis.service';
import { KafkaProducerService } from './kafka-producer.service';
import { PricesService } from './prices.service';
import { PriceBar } from './schemas/price-bar.schema';

// Typed handle to the mocked YF constructor + its shared chart/quote functions.
const MockYahooFinance = YahooFinance as unknown as jest.Mock & {
  _chart: jest.Mock;
  _quote: jest.Mock;
};

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
  price: 151.0,
  bid: 150.9,
  ask: 151.1,
  volume: 500,
  timestamp: '2024-01-01T10:30:45.000Z',
};

// Yahoo Finance chart() response shapes
const yfDailyChart = {
  quotes: [
    {
      date: new Date('2024-01-02T00:00:00Z'),
      open: 150,
      high: 155,
      low: 148,
      close: 152,
      volume: 1_000_000,
    },
  ],
};
const yfMinuteChart = {
  quotes: [
    {
      date: new Date('2024-01-02T14:30:00Z'),
      open: 150,
      high: 151,
      low: 149.5,
      close: 150.5,
      volume: 10_000,
    },
  ],
};
const emptyChart = { quotes: [] };

// Alpaca API response
const alpacaSuccess = {
  ok: true,
  json: () =>
    Promise.resolve({
      bars: [{ t: '2024-01-02T14:30:00Z', o: 150, h: 151, l: 149.5, c: 150.5, v: 10_000 }],
    }),
};
const alpacaEmpty = { ok: true, json: () => Promise.resolve({ bars: [] }) };
const alpacaError = { ok: false, status: 422 };

// ── module factory ────────────────────────────────────────────────────────

interface Fixture {
  service: PricesService;
  model: { findOneAndUpdate: jest.Mock; find: jest.Mock; bulkWrite: jest.Mock };
  redisGet: jest.Mock;
  redisSetex: jest.Mock;
  producer: { emit: jest.Mock };
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

async function buildModule(alpacaKey = '', alpacaSecret = ''): Promise<Fixture> {
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
      {
        provide: KafkaProducerService,
        useValue: { emit } satisfies Partial<KafkaProducerService>,
      },
      {
        provide: ConfigService,
        useValue: {
          get: jest.fn().mockImplementation((key: string) => {
            if (key === 'alpaca.apiKey') return alpacaKey;
            if (key === 'alpaca.apiSecret') return alpacaSecret;
            return '';
          }),
        },
      },
    ],
  }).compile();

  return {
    service: module.get<PricesService>(PricesService),
    model,
    redisGet,
    redisSetex,
    producer: { emit },
  };
}

// ── tests ─────────────────────────────────────────────────────────────────

describe('PricesService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global as typeof globalThis & { fetch: jest.Mock }).fetch = jest.fn();
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

    it('upserts the minute bar with correct operators', async () => {
      await service.process(rawMsg);

      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ symbol: 'AAPL' }),
        expect.objectContaining({
          $setOnInsert: expect.objectContaining({ open: 151.0 }) as unknown,
          $max: { high: 151.0 },
          $min: { low: 151.0 },
          $set: { close: 151.0 },
          $inc: { volume: 500 },
        }),
        { upsert: true, new: true },
      );
    });

    it('caches the latest price in Redis with 5s TTL', async () => {
      await service.process(rawMsg);
      expect(redisSetex).toHaveBeenCalledWith('price:latest:AAPL', 5, '151');
    });

    it('emits ProcessedPriceMessage to the processed topic', async () => {
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

    it('truncates the timestamp to the current minute', async () => {
      await service.process(rawMsg);

      const [query] = model.findOneAndUpdate.mock.calls[0] as [{ timestamp: Date }];
      expect(query.timestamp.getSeconds()).toBe(0);
      expect(query.timestamp.getMilliseconds()).toBe(0);
    });
  });

  // ── getHistory ────────────────────────────────────────────────────────────

  describe('getHistory', () => {
    describe('predefined symbols', () => {
      it('queries the DB directly without any on-demand fetch', async () => {
        const { service, redisGet } = await buildModule();

        await service.getHistory('AAPL', { limit: 60, interval: '1m' });

        // hist:fetched check must never be made for predefined symbols
        expect(redisGet).not.toHaveBeenCalledWith(expect.stringContaining('hist:fetched'));
        expect(MockYahooFinance._chart).not.toHaveBeenCalled();
      });
    });

    describe('non-predefined symbols — freshness flag isolation', () => {
      it('skips fetch when hist:fetched:<symbol>:1m is set', async () => {
        const { service, redisGet } = await buildModule();
        redisGet.mockImplementation((key: string) =>
          Promise.resolve(key === 'hist:fetched:SHOP:1m' ? '1' : null),
        );

        await service.getHistory('SHOP', { limit: 60, interval: '1m' });

        expect(MockYahooFinance._chart).not.toHaveBeenCalled();
      });

      it('does NOT skip 1m fetch when only hist:fetched:<symbol>:1d is set', async () => {
        // This is the regression test for the shared-flag bug: a completed daily
        // fetch must not suppress subsequent minute fetches.
        const { service, redisGet } = await buildModule();
        MockYahooFinance._chart.mockResolvedValue(emptyChart);
        redisGet.mockImplementation((key: string) =>
          Promise.resolve(key === 'hist:fetched:SHOP:1d' ? '1' : null),
        );

        await service.getHistory('SHOP', { limit: 60, interval: '1m' });

        // With separated flags, a fresh 1d flag must not block the 1m fetch.
        // Since there are no Alpaca credentials, it falls through to Yahoo Finance.
        expect(MockYahooFinance._chart).toHaveBeenCalled();
      });

      it('skips fetch when hist:no-data-min:<symbol> is set', async () => {
        const { service, redisGet } = await buildModule();
        redisGet.mockImplementation((key: string) =>
          Promise.resolve(key === 'hist:no-data-min:SHOP' ? '1' : null),
        );

        await service.getHistory('SHOP', { limit: 60, interval: '1m' });

        expect(MockYahooFinance._chart).not.toHaveBeenCalled();
      });
    });

    // ── minute history — no Alpaca credentials (Yahoo Finance path) ─────────

    describe('fetchAndStoreMinuteHistory — no Alpaca credentials', () => {
      it('calls Yahoo Finance chart when credentials are absent', async () => {
        const { service } = await buildModule(); // alpacaKey = ''
        MockYahooFinance._chart.mockResolvedValue(emptyChart);

        await service.getHistory('SHOP', { limit: 60, interval: '1m' });

        expect(MockYahooFinance._chart).toHaveBeenCalledWith(
          'SHOP',
          expect.objectContaining({ interval: '1m' }),
        );
      });

      it('stores returned bars and sets hist:fetched:<symbol>:1m on success', async () => {
        const { service, model, redisSetex } = await buildModule();
        MockYahooFinance._chart.mockResolvedValue(yfMinuteChart);

        await service.getHistory('SHOP', { limit: 60, interval: '1m' });

        expect(model.bulkWrite).toHaveBeenCalled();
        expect(redisSetex).toHaveBeenCalledWith('hist:fetched:SHOP:1m', 900, '1');
      });

      it('sets hist:no-data-min with 24h TTL when Yahoo returns no bars', async () => {
        const { service, redisSetex } = await buildModule();
        MockYahooFinance._chart.mockResolvedValue(emptyChart);

        await service.getHistory('SHOP', { limit: 60, interval: '1m' });

        expect(redisSetex).toHaveBeenCalledWith('hist:no-data-min:SHOP', 86_400, '1');
      });

      it('sets hist:no-data-min with 1h TTL when Yahoo throws', async () => {
        const { service, redisSetex } = await buildModule();
        MockYahooFinance._chart.mockRejectedValue(new Error('network error'));

        await service.getHistory('SHOP', { limit: 60, interval: '1m' });

        expect(redisSetex).toHaveBeenCalledWith('hist:no-data-min:SHOP', 3_600, '1');
      });
    });

    // ── minute history — with Alpaca credentials ─────────────────────────────

    describe('fetchAndStoreMinuteHistory — with Alpaca credentials', () => {
      const KEY = 'KEY';
      const SECRET = 'SECRET';

      it('fetches from Alpaca and sets hist:fetched:<symbol>:1m on success', async () => {
        const { service, model, redisSetex } = await buildModule(KEY, SECRET);
        (global as typeof globalThis & { fetch: jest.Mock }).fetch.mockResolvedValue(alpacaSuccess);

        await service.getHistory('UBER', { limit: 60, interval: '1m' });

        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('data.alpaca.markets'),
          expect.objectContaining({
            headers: expect.objectContaining({ 'APCA-API-KEY-ID': KEY }) as unknown,
          }),
        );
        expect(model.bulkWrite).toHaveBeenCalled();
        expect(redisSetex).toHaveBeenCalledWith('hist:fetched:UBER:1m', 900, '1');
        // Yahoo Finance must NOT be called when Alpaca succeeds
        expect(MockYahooFinance._chart).not.toHaveBeenCalled();
      });

      it('falls back to Yahoo Finance when Alpaca returns 0 bars', async () => {
        const { service } = await buildModule(KEY, SECRET);
        (global as typeof globalThis & { fetch: jest.Mock }).fetch.mockResolvedValue(alpacaEmpty);
        MockYahooFinance._chart.mockResolvedValue(emptyChart);

        await service.getHistory('SHOP', { limit: 60, interval: '1m' });

        expect(MockYahooFinance._chart).toHaveBeenCalled();
      });

      it('falls back to Yahoo Finance on Alpaca HTTP error', async () => {
        const { service } = await buildModule(KEY, SECRET);
        (global as typeof globalThis & { fetch: jest.Mock }).fetch.mockResolvedValue(alpacaError);
        MockYahooFinance._chart.mockResolvedValue(emptyChart);

        await service.getHistory('SHOP', { limit: 60, interval: '1m' });

        expect(MockYahooFinance._chart).toHaveBeenCalled();
      });

      it('falls back to Yahoo Finance when Alpaca fetch throws', async () => {
        const { service } = await buildModule(KEY, SECRET);
        (global as typeof globalThis & { fetch: jest.Mock }).fetch.mockRejectedValue(
          new Error('timeout'),
        );
        MockYahooFinance._chart.mockResolvedValue(emptyChart);

        await service.getHistory('SHOP', { limit: 60, interval: '1m' });

        expect(MockYahooFinance._chart).toHaveBeenCalled();
      });
    });

    // ── daily history ─────────────────────────────────────────────────────────

    describe('fetchAndStoreDailyHistory', () => {
      it('sets hist:fetched:<symbol>:1d (not :1m) on success', async () => {
        const { service, redisSetex } = await buildModule();
        MockYahooFinance._chart.mockResolvedValue(yfDailyChart);

        await service.getHistory('SHOP', { limit: 21, interval: '1d' });

        expect(redisSetex).toHaveBeenCalledWith('hist:fetched:SHOP:1d', 900, '1');
        expect(redisSetex).not.toHaveBeenCalledWith(
          'hist:fetched:SHOP:1m',
          expect.anything(),
          expect.anything(),
        );
      });

      it('skips fetch when hist:no-data:<symbol> is set', async () => {
        const { service, redisGet } = await buildModule();
        redisGet.mockImplementation((key: string) =>
          Promise.resolve(key === 'hist:no-data:SHOP' ? '1' : null),
        );

        await service.getHistory('SHOP', { limit: 21, interval: '1d' });

        expect(MockYahooFinance._chart).not.toHaveBeenCalled();
      });

      it('sets hist:no-data with 24h TTL when Yahoo returns no bars', async () => {
        const { service, redisSetex } = await buildModule();
        MockYahooFinance._chart.mockResolvedValue(emptyChart);

        await service.getHistory('SHOP', { limit: 21, interval: '1d' });

        expect(redisSetex).toHaveBeenCalledWith('hist:no-data:SHOP', 86_400, '1');
      });

      it('sets hist:no-data with 1h TTL when Yahoo throws', async () => {
        const { service, redisSetex } = await buildModule();
        MockYahooFinance._chart.mockRejectedValue(new Error('YF down'));

        await service.getHistory('SHOP', { limit: 21, interval: '1d' });

        expect(redisSetex).toHaveBeenCalledWith('hist:no-data:SHOP', 3_600, '1');
      });
    });
  });
});
