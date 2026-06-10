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
  private readonly consumer: Consumer;

  constructor(
    config: ConfigService,
    @InjectModel(Portfolio.name) private readonly portfolioModel: Model<Portfolio>,
  ) {
    const kafka = new Kafka({
      clientId: 'portfolio-service-consumer',
      brokers: config.getOrThrow<string[]>('kafka.brokers'),
    });
    this.consumer = kafka.consumer({ groupId: KAFKA_GROUP_IDS.PORTFOLIO_SERVICE });
  }

  async onModuleInit(): Promise<void> {
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
  }

  private async updateHoldingPrices(symbol: string, price: number): Promise<void> {
    await this.portfolioModel.updateMany(
      { 'stocks.symbol': symbol },
      { $set: { 'stocks.$[elem].latestPrice': price } },
      { arrayFilters: [{ 'elem.symbol': symbol }] },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer.disconnect();
  }
}
