import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KAFKA_GROUP_IDS, KAFKA_TOPICS } from '@yana-stocks/kafka-client';
import type { RawPriceMessage } from '@yana-stocks/shared-types';
import { Consumer, Kafka } from 'kafkajs';
import { PricesService } from './prices.service';

@Injectable()
export class KafkaConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumerService.name);
  private readonly consumer: Consumer;

  constructor(
    config: ConfigService,
    private readonly pricesService: PricesService,
  ) {
    const kafka = new Kafka({
      clientId: 'price-processor-consumer',
      brokers: config.getOrThrow<string[]>('kafka.brokers'),
    });
    this.consumer = kafka.consumer({ groupId: KAFKA_GROUP_IDS.PRICE_PROCESSOR });
  }

  async onModuleInit(): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({
      topic: KAFKA_TOPICS.PRICES_RAW,
      fromBeginning: false,
    });
    await this.consumer.run({
      eachMessage: async ({ message }) => {
        const raw = message.value?.toString();
        if (!raw) return;
        try {
          const msg = JSON.parse(raw) as RawPriceMessage;
          await this.pricesService.process(msg);
        } catch (err) {
          this.logger.error('Failed to process message: %s', (err as Error).message, err);
        }
      },
    });
    this.logger.log('Kafka consumer subscribed to %s', KAFKA_TOPICS.PRICES_RAW);
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer.disconnect();
  }
}
