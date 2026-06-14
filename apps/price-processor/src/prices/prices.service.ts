import { Injectable, Logger } from '@nestjs/common';
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

@Injectable()
export class PricesService {
  private readonly logger = new Logger(PricesService.name);

  constructor(
    @InjectModel(PriceBar.name) private readonly priceBarsModel: Model<PriceBar>,
    private readonly redis: RedisService,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

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

    if (bars.length === 0 && interval === '1d') {
      bars = await this.fetchAndStoreDailyHistory(symbol, opts.limit, filter);
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
