import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ProcessedPriceMessage, RawPriceMessage } from '@yana-stocks/shared-types';
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
          $setOnInsert: { symbol: msg.symbol, timestamp: minuteTs, open: msg.price },
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

  private truncateToMinute(isoTimestamp: string): Date {
    const d = new Date(isoTimestamp);
    d.setSeconds(0, 0);
    return d;
  }
}
