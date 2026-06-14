import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { OHLCV, ProcessedPriceMessage, RawPriceMessage } from '@yana-stocks/shared-types';
import { KAFKA_TOPICS } from '@yana-stocks/kafka-client';
import { Model } from 'mongoose';
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
          $setOnInsert: { symbol: msg.symbol, timestamp: minuteTs, open: msg.price, interval: '1m' },
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

    const bars = await this.priceBarsModel
      .find(filter)
      .sort({ timestamp: -1 })
      .limit(opts.limit)
      .lean<PriceBar[]>()
      .exec();

    return bars.map((b) => ({
      symbol: b.symbol,
      timestamp: b.timestamp,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
      interval: b.interval ?? '1m',
    }));
  }

  private truncateToMinute(isoTimestamp: string): Date {
    const d = new Date(isoTimestamp);
    d.setSeconds(0, 0);
    return d;
  }
}
