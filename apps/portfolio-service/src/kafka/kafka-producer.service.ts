import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PortfolioEventMessage } from '@yana-stocks/shared-types';
import { KAFKA_TOPICS } from '@yana-stocks/kafka-client';
import { Kafka, Producer } from 'kafkajs';

@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducerService.name);
  private readonly producer: Producer;

  constructor(config: ConfigService) {
    const kafka = new Kafka({
      clientId: 'portfolio-service-producer',
      brokers: config.getOrThrow<string[]>('kafka.brokers'),
    });
    this.producer = kafka.producer();
  }

  async onModuleInit(): Promise<void> {
    await this.producer.connect();
    this.logger.log('Kafka producer connected');
  }

  async emitPortfolioEvent(event: PortfolioEventMessage): Promise<void> {
    await this.producer.send({
      topic: KAFKA_TOPICS.PORTFOLIO_EVENTS,
      messages: [{ key: event.portfolioId, value: JSON.stringify(event) }],
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.producer.disconnect();
  }
}
