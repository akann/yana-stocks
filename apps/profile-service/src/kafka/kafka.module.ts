import { Module } from '@nestjs/common';
import { ProfileModule } from '../profile/profile.module';
import { KafkaConsumerService } from './kafka-consumer.service';

@Module({
  imports: [ProfileModule],
  providers: [KafkaConsumerService],
})
export class KafkaModule {}
