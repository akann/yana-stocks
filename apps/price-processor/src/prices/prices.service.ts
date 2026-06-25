import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import type {
  OHLCV,
  OHLCVInterval,
  ProcessedPriceMessage,
  RawPriceMessage,
} from '@yana-stocks/shared-types';
import { KAFKA_TOPICS } from '@yana-stocks/kafka-client';
import type { AxiosInstance } from 'axios';
import { Model } from 'mongoose';
import { RedisService } from '../redis/redis.service';
import { KafkaProducerService } from './kafka-producer.service';
import { PriceBar } from './schemas/price-bar.schema';

export const POLYGON_HTTP = 'POLYGON_HTTP';

interface PolygonBar {
  t?: number;
  o?: number;
  h?: number;
  l?: number;
  c?: number;
  v?: number;
}

interface PolygonSnapshotResp {
  ticker?: {
    day?: { c?: number; v?: number };
    prevDay?: { c?: number };
  } | null;
}

interface PolygonAggregatesResp {
  results?: PolygonBar[];
}

const PRICE_CACHE_TTL = 5;
const QUOTE_CACHE_TTL = 900;
const HISTORY_FETCH_TTL = 900;

export interface QuoteEntry {
  price: number;
  prevPrice: number;
  change: number;
  changePercent: number;
  volume: number;
  timestamp: string;
}

@Injectable()
export class PricesService {
  private readonly logger = new Logger(PricesService.name);
  private readonly apiKey: string;

  constructor(
    @InjectModel(PriceBar.name) private readonly priceBarsModel: Model<PriceBar>,
    private readonly redis: RedisService,
    private readonly kafkaProducer: KafkaProducerService,
    @Inject(POLYGON_HTTP) private readonly http: AxiosInstance,
    config: ConfigService,
  ) {
    this.apiKey = config.get<string>('massive.apiKey') ?? '';
  }

  async process(msg: RawPriceMessage): Promise<void> {
    await this.priceBarsModel
      .findOneAndUpdate(
        { symbol: msg.symbol, timestamp: new Date(msg.timestamp), interval: '1m' },
        {
          $setOnInsert: {
            symbol: msg.symbol,
            timestamp: new Date(msg.timestamp),
            open: msg.open,
            high: msg.high,
            low: msg.low,
            close: msg.close,
            volume: msg.volume,
            interval: '1m',
          },
        },
        { upsert: true, new: true },
      )
      .lean<PriceBar>()
      .exec();

    // close is the authoritative "latest price" for a completed minute bar
    await this.redis.setex(`price:latest:${msg.symbol}`, PRICE_CACHE_TTL, String(msg.close));

    const processed: ProcessedPriceMessage = {
      symbol: msg.symbol,
      price: msg.close,
      ohlcv: {
        open: msg.open,
        high: msg.high,
        low: msg.low,
        close: msg.close,
        volume: msg.volume,
      },
      timestamp: msg.timestamp,
    };

    await this.kafkaProducer.emit(KAFKA_TOPICS.PRICES_PROCESSED, msg.symbol, processed);
  }

  async getHistory(
    symbol: string,
    opts: { limit: number; from?: string; to?: string; interval?: string },
  ): Promise<OHLCV[]> {
    const interval = opts.interval ?? '1m';
    const filter: Record<string, unknown> = { symbol };
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

    const isFresh = !!(await this.redis.get(`hist:fetched:${symbol}:${interval}`));
    if (!isFresh) {
      const fetched = await this.fetchAndStoreHistory(symbol, interval, opts.limit, filter);
      if (fetched.length > 0) bars = fetched;
    }

    // MongoDB can store multiple bars per trading day at different UTC offsets
    // (T00, T04, T05 …). Keep only the first bar seen per date for daily intervals;
    // bars are sorted DESC so first = highest UTC = most recently stored.
    const seenDates = new Set<string>();
    return bars
      .map((b) => ({
        symbol: b.symbol,
        timestamp: b.timestamp,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
        interval: (b.interval ?? '1m') as OHLCVInterval,
      }))
      .filter((bar) => {
        if (interval !== '1d') return true;
        const dateKey = new Date(bar.timestamp).toISOString().slice(0, 10);
        if (seenDates.has(dateKey)) return false;
        seenDates.add(dateKey);
        return true;
      });
  }

  async getQuote(symbol: string): Promise<QuoteEntry | null> {
    const cacheKey = `price:quote:${symbol}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as QuoteEntry;

    try {
      const resp = await this.http.get<PolygonSnapshotResp>(
        `/v2/snapshot/locale/us/markets/stocks/tickers/${symbol}`,
        { params: { apiKey: this.apiKey } },
      );
      const ticker = resp.data.ticker;
      const close = ticker?.day?.c;
      const prevClose = ticker?.prevDay?.c;
      const volume = ticker?.day?.v;

      if (!close || !prevClose) return null;

      const change = close - prevClose;
      const changePercent = (change / prevClose) * 100;

      const entry: QuoteEntry = {
        price: close,
        prevPrice: prevClose,
        change,
        changePercent,
        volume: volume ?? 0,
        timestamp: new Date().toISOString(),
      };

      await this.redis.setex(cacheKey, QUOTE_CACHE_TTL, JSON.stringify(entry));
      return entry;
    } catch (err) {
      this.logger.warn('Massive snapshot failed for %s: %s', symbol, (err as Error).message);
      return null;
    }
  }

  private async fetchAndStoreHistory(
    symbol: string,
    interval: string,
    limit: number,
    filter: Record<string, unknown>,
  ): Promise<PriceBar[]> {
    const noDataKey = `hist:no-data:${symbol}:${interval}`;
    if (await this.redis.get(noDataKey)) return [];

    const timespan = interval === '1d' ? 'day' : 'minute';
    const lookbackDays = interval === '1d' ? 730 : 3;

    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - lookbackDays);

    const toStr = to.toISOString().slice(0, 10);
    const fromStr = from.toISOString().slice(0, 10);

    try {
      const resp = await this.http.get<PolygonAggregatesResp>(
        `/v2/aggs/ticker/${symbol}/range/1/${timespan}/${fromStr}/${toStr}`,
        { params: { adjusted: true, limit: 50000, apiKey: this.apiKey } },
      );

      const results = resp.data.results ?? [];
      if (results.length === 0) {
        await this.redis.setex(noDataKey, 86400, '1');
        return [];
      }

      this.logger.log('Fetched %d %s bars from Massive for %s', results.length, interval, symbol);

      const ops = results.map((bar: PolygonBar) => ({
        updateOne: {
          filter: {
            symbol,
            timestamp: new Date(bar.t ?? 0),
            interval,
          },
          update: {
            $setOnInsert: {
              symbol,
              timestamp: new Date(bar.t ?? 0),
              open: bar.o ?? 0,
              high: bar.h ?? 0,
              low: bar.l ?? 0,
              close: bar.c ?? 0,
              volume: bar.v ?? 0,
              interval,
            },
          },
          upsert: true,
        },
      }));

      await this.priceBarsModel.bulkWrite(ops, { ordered: false });
      await this.redis.setex(`hist:fetched:${symbol}:${interval}`, HISTORY_FETCH_TTL, '1');

      return this.priceBarsModel
        .find(filter)
        .sort({ timestamp: -1 })
        .limit(limit)
        .lean<PriceBar[]>()
        .exec();
    } catch (err) {
      this.logger.warn(
        'Massive history fetch failed for %s (%s): %s',
        symbol,
        interval,
        (err as Error).message,
      );
      return [];
    }
  }
}
