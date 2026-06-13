import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KAFKA_GROUP_IDS, KAFKA_TOPICS } from '@yana-stocks/kafka-client';
import type { RawPriceMessage } from '@yana-stocks/shared-types';
import { Consumer, Kafka } from 'kafkajs';
import { PricesService } from './prices.service';

@Injectable()
export class KafkaConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumerService.name);
  private readonly kafka: Kafka;
  private consumer: Consumer;
  private stopping = false;

  constructor(
    config: ConfigService,
    private readonly pricesService: PricesService,
  ) {
    const brokers = config.getOrThrow<string[]>('kafka.brokers');
    this.kafka = new Kafka({ clientId: 'price-processor-consumer', brokers });
    this.consumer = this.kafka.consumer({ groupId: KAFKA_GROUP_IDS.PRICE_PROCESSOR });
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
    this.consumer = this.kafka.consumer({ groupId: KAFKA_GROUP_IDS.PRICE_PROCESSOR });
    setTimeout(() => void this.start(), 5000);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await this.consumer.disconnect();
  }
}
