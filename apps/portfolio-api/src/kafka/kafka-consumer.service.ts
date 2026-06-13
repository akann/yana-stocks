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
  private readonly kafka: Kafka;
  private consumer: Consumer;
  private stopping = false;

  constructor(
    config: ConfigService,
    private readonly redis: RedisService,
  ) {
    const brokers = config.getOrThrow<string[]>('kafka.brokers');
    this.kafka = new Kafka({ clientId: 'portfolio-api', brokers });
    this.consumer = this.kafka.consumer({ groupId: KAFKA_GROUP_IDS.PORTFOLIO_API });
  }

  async onModuleInit(): Promise<void> {
    await this.start();
  }

  private async start(): Promise<void> {
    if (this.stopping) return;

    this.consumer.on(this.consumer.events.CRASH, ({ payload }) => {
      this.logger.error('Kafka consumer crashed: %s — reconnecting in 5s', payload.error.message);
      void this.restart();
    });

    try {
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
    } catch (err) {
      this.logger.error('Kafka consumer start failed: %s — retrying in 30s', String(err));
      setTimeout(() => void this.restart(), 30000);
    }
  }

  private async restart(): Promise<void> {
    if (this.stopping) return;
    try {
      await this.consumer.disconnect();
    } catch (err) {
      this.logger.warn('Kafka disconnect error: %s', String(err));
    }
    this.consumer = this.kafka.consumer({ groupId: KAFKA_GROUP_IDS.PORTFOLIO_API });
    setTimeout(() => void this.start(), 5000);
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
      this.redis.set(`papi:price:${msg.symbol}`, JSON.stringify(entry), 86400),
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
    this.stopping = true;
    await this.consumer.disconnect();
  }
}
