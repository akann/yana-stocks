import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KAFKA_GROUP_IDS, KAFKA_TOPICS } from '@yana-stocks/kafka-client';
import type {
  ProcessedPriceMessage,
  PredictionSignal,
  SentimentSignal,
} from '@yana-stocks/shared-types';
import { Consumer, Kafka } from 'kafkajs';
import { RedisService } from '../redis/redis.service';
import type { PriceCacheEntry } from '../stocks/price-cache.types';

@Injectable()
export class KafkaConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumerService.name);
  private readonly consumer: Consumer;

  constructor(
    config: ConfigService,
    private readonly redis: RedisService,
  ) {
    const brokers = config.getOrThrow<string[]>('kafka.brokers');
    const kafka = new Kafka({ clientId: 'portfolio-api', brokers });
    this.consumer = kafka.consumer({ groupId: KAFKA_GROUP_IDS.PORTFOLIO_API });
  }

  async onModuleInit(): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({
      topics: [
        KAFKA_TOPICS.PRICES_PROCESSED,
        KAFKA_TOPICS.SIGNALS_SENTIMENT,
        KAFKA_TOPICS.SIGNALS_PREDICTION,
      ],
      fromBeginning: false,
    });

    await this.consumer.run({
      eachMessage: async ({ topic, message }) => {
        if (!message.value) return;
        const raw = message.value.toString();

        try {
          if (topic === KAFKA_TOPICS.PRICES_PROCESSED) {
            await this.handlePrice(JSON.parse(raw) as ProcessedPriceMessage);
          } else if (topic === KAFKA_TOPICS.SIGNALS_SENTIMENT) {
            await this.handleSentiment(JSON.parse(raw) as SentimentSignal);
          } else if (topic === KAFKA_TOPICS.SIGNALS_PREDICTION) {
            await this.handlePrediction(JSON.parse(raw) as PredictionSignal);
          }
        } catch (err) {
          this.logger.error('Failed to process message from %s: %s', topic, String(err));
        }
      },
    });
  }

  private async handlePrice(msg: ProcessedPriceMessage): Promise<void> {
    const existing = await this.redis.get(`papi:price:${msg.symbol}`);
    const prevPrice = existing ? (JSON.parse(existing) as PriceCacheEntry).price : msg.price;

    const change = msg.price - prevPrice;
    const changePercent = prevPrice !== 0 ? (change / prevPrice) * 100 : 0;

    const entry: PriceCacheEntry = {
      price: msg.price,
      prevPrice,
      change,
      changePercent,
      volume: msg.ohlcv.volume,
      timestamp: msg.timestamp,
    };

    await Promise.all([
      this.redis.set(`papi:price:${msg.symbol}`, JSON.stringify(entry), 60),
      this.redis.del('papi:movers'),
    ]);
  }

  private async handleSentiment(msg: SentimentSignal): Promise<void> {
    await this.redis.set(`papi:sentiment:${msg.symbol}`, JSON.stringify(msg), 3600);
  }

  private async handlePrediction(msg: PredictionSignal): Promise<void> {
    await this.redis.set(`papi:prediction:${msg.symbol}`, JSON.stringify(msg), 3600);
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer.disconnect();
  }
}
