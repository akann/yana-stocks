import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KAFKA_GROUP_IDS, KAFKA_TOPICS } from '@yana-stocks/kafka-client';
import { Consumer, Kafka } from 'kafkajs';
import { ProfileService } from '../profile/profile.service';

interface UserRegisteredEvent {
  userId: string;
  email: string;
  timestamp: string;
}

@Injectable()
export class KafkaConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumerService.name);
  private readonly kafka: Kafka;
  private consumer: Consumer;
  private stopping = false;

  constructor(
    config: ConfigService,
    private readonly profileService: ProfileService,
  ) {
    const brokers = config.getOrThrow<string[]>('kafka.brokers');
    this.kafka = new Kafka({ clientId: 'profile-service-consumer', brokers });
    this.consumer = this.kafka.consumer({ groupId: KAFKA_GROUP_IDS.PROFILE_SERVICE });
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
      await this.consumer.subscribe({ topic: KAFKA_TOPICS.USERS_REGISTERED, fromBeginning: false });
      await this.consumer.run({
        eachMessage: async ({ message }) => {
          const raw = message.value?.toString();
          if (!raw) return;
          try {
            const event = JSON.parse(raw) as UserRegisteredEvent;
            await this.profileService.createDefaultProfile(event.userId);
          } catch (err) {
            this.logger.error('Failed to process users.registered event: %s', String(err));
          }
        },
      });
      this.logger.log('Subscribed to %s', KAFKA_TOPICS.USERS_REGISTERED);
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
    this.consumer = this.kafka.consumer({ groupId: KAFKA_GROUP_IDS.PROFILE_SERVICE });
    setTimeout(() => void this.start(), 5000);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await this.consumer.disconnect();
  }
}
