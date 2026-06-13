import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { KAFKA_GROUP_IDS, KAFKA_TOPICS } from '@yana-stocks/kafka-client';
import type { ProcessedPriceMessage } from '@yana-stocks/shared-types';
import { Consumer, Kafka } from 'kafkajs';
import { Model } from 'mongoose';
import { Portfolio } from '../portfolios/schemas/portfolio.schema';

@Injectable()
export class KafkaConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumerService.name);
  private readonly kafka: Kafka;
  private consumer: Consumer;
  private stopping = false;

  constructor(
    config: ConfigService,
    @InjectModel(Portfolio.name) private readonly portfolioModel: Model<Portfolio>,
  ) {
    const brokers = config.getOrThrow<string[]>('kafka.brokers');
    this.kafka = new Kafka({ clientId: 'portfolio-service-consumer', brokers });
    this.consumer = this.kafka.consumer({ groupId: KAFKA_GROUP_IDS.PORTFOLIO_SERVICE });
  }

  onModuleInit(): void {
    void this.start();
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
        topic: KAFKA_TOPICS.PRICES_PROCESSED,
        fromBeginning: false,
      });
      await this.consumer.run({
        eachMessage: async ({ message }) => {
          const raw = message.value?.toString();
          if (!raw) return;
          try {
            const msg = JSON.parse(raw) as ProcessedPriceMessage;
            await this.updateHoldingPrices(msg.symbol, msg.price);
          } catch (err) {
            this.logger.error('Failed to process price update: %s', (err as Error).message);
          }
        },
      });
      this.logger.log('Subscribed to %s', KAFKA_TOPICS.PRICES_PROCESSED);
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
    this.consumer = this.kafka.consumer({ groupId: KAFKA_GROUP_IDS.PORTFOLIO_SERVICE });
    setTimeout(() => void this.start(), 5000);
  }

  private async updateHoldingPrices(symbol: string, price: number): Promise<void> {
    await this.portfolioModel.updateMany(
      { 'stocks.symbol': symbol },
      { $set: { 'stocks.$[elem].latestPrice': price } },
      { arrayFilters: [{ 'elem.symbol': symbol }] },
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await this.consumer.disconnect();
  }
}
