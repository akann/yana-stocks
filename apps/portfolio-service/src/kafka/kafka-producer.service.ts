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

  onModuleInit(): void {
    void this.connect();
  }

  private async connect(): Promise<void> {
    try {
      await this.producer.connect();
      this.logger.log('Kafka producer connected');
    } catch (err) {
      this.logger.error('Kafka producer connect failed: %s — retrying in 30s', String(err));
      setTimeout(() => void this.connect(), 30_000);
    }
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
