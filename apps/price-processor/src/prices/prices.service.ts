import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import type {
  OHLCV,
  OHLCVInterval,
  ProcessedPriceMessage,
  RawPriceMessage,
} from '@yana-stocks/shared-types';
import { KAFKA_TOPICS } from '@yana-stocks/kafka-client';
import { Model } from 'mongoose';
import YahooFinance from 'yahoo-finance2';

const yf = new YahooFinance();
import { RedisService } from '../redis/redis.service';
import { KafkaProducerService } from './kafka-producer.service';
import { PriceBar } from './schemas/price-bar.schema';

const PRICE_CACHE_TTL = 5;
const QUOTE_CACHE_TTL = 900; // 15 minutes — matches ON_DEMAND_FETCH_TTL
const ON_DEMAND_FETCH_TTL = 900; // 15 minutes

const PREDEFINED_SYMBOLS = new Set([
  'AAPL',
  'GOOGL',
  'MSFT',
  'AMZN',
  'TSLA',
  'NVDA',
  'META',
  'JPM',
  'V',
  'JNJ',
]);

export interface QuoteEntry {
  price: number;
  prevPrice: number;
  change: number;
  changePercent: number;
  volume: number;
  timestamp: string;
}

interface AlpacaBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface YFQuoteFields {
  regularMarketPrice?: number | null;
  regularMarketChange?: number | null;
  regularMarketChangePercent?: number | null;
  regularMarketVolume?: number | null;
  regularMarketTime?: Date | number | null;
}

@Injectable()
export class PricesService {
  private readonly logger = new Logger(PricesService.name);
  private readonly alpacaKey: string;
  private readonly alpacaSecret: string;

  constructor(
    @InjectModel(PriceBar.name) private readonly priceBarsModel: Model<PriceBar>,
    private readonly redis: RedisService,
    private readonly kafkaProducer: KafkaProducerService,
    config: ConfigService,
  ) {
    this.alpacaKey = config.get<string>('alpaca.apiKey') ?? '';
    this.alpacaSecret = config.get<string>('alpaca.apiSecret') ?? '';
  }

  async process(msg: RawPriceMessage): Promise<void> {
    const minuteTs = this.truncateToMinute(msg.timestamp);

    const bar = await this.priceBarsModel
      .findOneAndUpdate(
        { symbol: msg.symbol, timestamp: minuteTs },
        {
          $setOnInsert: {
            symbol: msg.symbol,
            timestamp: minuteTs,
            open: msg.price,
            interval: '1m',
          },
          $max: { high: msg.price },
          $min: { low: msg.price },
          $set: { close: msg.price },
          $inc: { volume: msg.volume },
        },
        { upsert: true, new: true },
      )
      .lean<PriceBar>()
      .exec();

    if (!bar) {
      this.logger.error('Failed to upsert bar for %s', msg.symbol);
      return;
    }

    await this.redis.setex(`price:latest:${msg.symbol}`, PRICE_CACHE_TTL, String(msg.price));

    const processed: ProcessedPriceMessage = {
      symbol: msg.symbol,
      price: msg.price,
      ohlcv: {
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      },
      timestamp: msg.timestamp,
    };

    await this.kafkaProducer.emit(KAFKA_TOPICS.PRICES_PROCESSED, msg.symbol, processed);
  }

  async getHistory(
    symbol: string,
    opts: { limit: number; from?: string; to?: string; interval?: string },
  ): Promise<OHLCV[]> {
    const filter: Record<string, unknown> = { symbol };

    const interval = opts.interval ?? '1m';
    // null in $in matches both null values and missing fields, so old docs
    // without an interval field are treated as '1m' bars.
    filter['interval'] = interval === '1m' ? { $in: ['1m', null] } : interval;

    if (opts.from ?? opts.to) {
      const tsFilter: Record<string, Date> = {};
      if (opts.from) tsFilter['$gte'] = new Date(opts.from);
      if (opts.to) tsFilter['$lte'] = new Date(opts.to);
      filter['timestamp'] = tsFilter;
    }

    let bars = await this.priceBarsModel
      .find(filter)
      .sort({ timestamp: -1 })
      .limit(opts.limit)
      .lean<PriceBar[]>()
      .exec();

    if (!PREDEFINED_SYMBOLS.has(symbol)) {
      // Separate freshness flag per interval so a daily fetch never blocks a
      // minute fetch and vice versa.
      const isFresh = !!(await this.redis.get(`hist:fetched:${symbol}:${interval}`));
      if (!isFresh && interval === '1d') {
        bars = await this.fetchAndStoreDailyHistory(symbol, opts.limit, filter);
      }
      if (!isFresh && interval === '1m') {
        bars = await this.fetchAndStoreMinuteHistory(symbol, opts.limit, filter);
      }
    }

    return bars.map((b) => ({
      symbol: b.symbol,
      timestamp: b.timestamp,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
      interval: (b.interval ?? '1m') as OHLCVInterval,
    }));
  }

  async getQuote(symbol: string): Promise<QuoteEntry | null> {
    const cacheKey = `price:quote:${symbol}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as QuoteEntry;

    try {
      // Cast through unknown — yf.quote() loses its generic type at runtime
      const q = (await yf.quote(symbol)) as unknown as YFQuoteFields;
      if (!q.regularMarketPrice) return null;

      const price: number = q.regularMarketPrice;
      const change: number = q.regularMarketChange ?? 0;
      const changePercent: number = q.regularMarketChangePercent ?? 0;
      const volume: number = q.regularMarketVolume ?? 0;
      const marketTime = q.regularMarketTime;
      const timestamp =
        marketTime instanceof Date
          ? marketTime.toISOString()
          : typeof marketTime === 'number'
            ? new Date(marketTime * 1000).toISOString()
            : new Date().toISOString();

      const entry: QuoteEntry = {
        price,
        prevPrice: price - change,
        change,
        changePercent,
        volume,
        timestamp,
      };

      await this.redis.setex(cacheKey, QUOTE_CACHE_TTL, JSON.stringify(entry));
      return entry;
    } catch (err) {
      this.logger.warn('Yahoo Finance quote failed for %s: %s', symbol, (err as Error).message);
      return null;
    }
  }

  private async fetchAndStoreMinuteHistory(
    symbol: string,
    limit: number,
    filter: Record<string, unknown>,
  ): Promise<PriceBar[]> {
    const noDataKey = `hist:no-data-min:${symbol}`;
    const hasNoData = await this.redis.get(noDataKey);
    if (hasNoData) return [];

    if (!this.alpacaKey || !this.alpacaSecret) {
      return this.fetchAndStoreMinuteHistoryYahoo(symbol, limit, filter, noDataKey);
    }

    try {
      const end = new Date();
      const start = new Date(end);
      start.setDate(start.getDate() - 3);

      const params = new URLSearchParams({
        timeframe: '1Min',
        start: start.toISOString(),
        end: end.toISOString(),
        limit: '10000',
        adjustment: 'raw',
        feed: 'iex',
      });

      const resp = await fetch(
        `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/bars?${params.toString()}`,
        {
          headers: {
            'APCA-API-KEY-ID': this.alpacaKey,
            'APCA-API-SECRET-KEY': this.alpacaSecret,
          },
        },
      );

      if (!resp.ok) {
        this.logger.warn('Alpaca bars request failed for %s: HTTP %d', symbol, resp.status);
        return this.fetchAndStoreMinuteHistoryYahoo(symbol, limit, filter, noDataKey);
      }

      const data = (await resp.json()) as { bars?: AlpacaBar[] };
      const alpacaBars = data.bars ?? [];

      if (alpacaBars.length === 0) {
        // Alpaca IEX has no coverage for this symbol (e.g. TSX-listed stocks).
        // Fall back to Yahoo Finance for intraday 1m bars.
        return this.fetchAndStoreMinuteHistoryYahoo(symbol, limit, filter, noDataKey);
      }

      this.logger.log('Fetched %d minute bars from Alpaca for %s', alpacaBars.length, symbol);
      await this.redis.setex(`hist:fetched:${symbol}:1m`, ON_DEMAND_FETCH_TTL, '1');

      const ops = alpacaBars.map((bar) => ({
        updateOne: {
          filter: { symbol, timestamp: new Date(bar.t), interval: '1m' },
          update: {
            $setOnInsert: {
              symbol,
              timestamp: new Date(bar.t),
              open: bar.o,
              high: bar.h,
              low: bar.l,
              close: bar.c,
              volume: bar.v,
              interval: '1m',
            },
          },
          upsert: true,
        },
      }));

      await this.priceBarsModel.bulkWrite(ops, { ordered: false });

      return this.priceBarsModel
        .find(filter)
        .sort({ timestamp: -1 })
        .limit(limit)
        .lean<PriceBar[]>()
        .exec();
    } catch (err) {
      this.logger.warn('Alpaca minute fetch failed for %s: %s', symbol, (err as Error).message);
      return this.fetchAndStoreMinuteHistoryYahoo(symbol, limit, filter, noDataKey);
    }
  }

  private async fetchAndStoreMinuteHistoryYahoo(
    symbol: string,
    limit: number,
    filter: Record<string, unknown>,
    noDataKey: string,
  ): Promise<PriceBar[]> {
    try {
      const end = new Date();
      const start = new Date(end);
      start.setDate(start.getDate() - 3);

      const chart = await yf.chart(symbol, {
        period1: start,
        period2: end,
        interval: '1m',
        return: 'array',
      });

      const rows = chart.quotes.flatMap((q) => {
        if (
          q.open === null ||
          q.high === null ||
          q.low === null ||
          q.close === null ||
          q.volume === null
        )
          return [];
        return [
          {
            date: q.date,
            open: q.open,
            high: q.high,
            low: q.low,
            close: q.close,
            volume: q.volume,
          },
        ];
      });

      if (rows.length === 0) {
        await this.redis.setex(noDataKey, 86_400, '1');
        return [];
      }

      this.logger.log('Fetched %d minute bars from Yahoo Finance for %s', rows.length, symbol);
      await this.redis.setex(`hist:fetched:${symbol}:1m`, ON_DEMAND_FETCH_TTL, '1');

      const ops = rows.map((row) => ({
        updateOne: {
          filter: { symbol, timestamp: row.date, interval: '1m' },
          update: {
            $setOnInsert: {
              symbol,
              timestamp: row.date,
              open: row.open,
              high: row.high,
              low: row.low,
              close: row.close,
              volume: row.volume,
              interval: '1m',
            },
          },
          upsert: true,
        },
      }));

      await this.priceBarsModel.bulkWrite(ops, { ordered: false });

      return this.priceBarsModel
        .find(filter)
        .sort({ timestamp: -1 })
        .limit(limit)
        .lean<PriceBar[]>()
        .exec();
    } catch (err) {
      this.logger.warn(
        'Yahoo Finance minute fetch failed for %s: %s',
        symbol,
        (err as Error).message,
      );
      await this.redis.setex(noDataKey, 3_600, '1');
      return [];
    }
  }

  private async fetchAndStoreDailyHistory(
    symbol: string,
    limit: number,
    filter: Record<string, unknown>,
  ): Promise<PriceBar[]> {
    const noDataKey = `hist:no-data:${symbol}`;
    const hasNoData = await this.redis.get(noDataKey);
    if (hasNoData) return [];

    try {
      const end = new Date();
      const start = new Date(end);
      start.setFullYear(start.getFullYear() - 1);

      const chart = await yf.chart(symbol, {
        period1: start,
        period2: end,
        interval: '1d',
        return: 'array',
      });

      // Filter out any rows where core OHLCV fields are null
      const rows = chart.quotes.flatMap((q) => {
        if (
          q.open === null ||
          q.high === null ||
          q.low === null ||
          q.close === null ||
          q.volume === null
        )
          return [];
        return [
          {
            date: q.date,
            open: q.open,
            high: q.high,
            low: q.low,
            close: q.close,
            volume: q.volume,
          },
        ];
      });

      if (rows.length === 0) {
        await this.redis.setex(noDataKey, 86_400, '1');
        return [];
      }

      this.logger.log('Fetched %d daily bars from Yahoo Finance for %s', rows.length, symbol);
      await this.redis.setex(`hist:fetched:${symbol}:1d`, ON_DEMAND_FETCH_TTL, '1');

      const ops = rows.map((row) => ({
        updateOne: {
          filter: { symbol, timestamp: row.date, interval: '1d' },
          update: {
            $setOnInsert: {
              symbol,
              timestamp: row.date,
              open: row.open,
              high: row.high,
              low: row.low,
              close: row.close,
              volume: row.volume,
              interval: '1d',
            },
          },
          upsert: true,
        },
      }));

      await this.priceBarsModel.bulkWrite(ops, { ordered: false });

      return this.priceBarsModel
        .find(filter)
        .sort({ timestamp: -1 })
        .limit(limit)
        .lean<PriceBar[]>()
        .exec();
    } catch (err) {
      this.logger.warn('Yahoo Finance fetch failed for %s: %s', symbol, (err as Error).message);
      await this.redis.setex(noDataKey, 3_600, '1');
      return [];
    }
  }

  private truncateToMinute(isoTimestamp: string): Date {
    const d = new Date(isoTimestamp);
    d.setSeconds(0, 0);
    return d;
  }
}
