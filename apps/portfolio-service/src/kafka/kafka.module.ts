import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Portfolio, PortfolioSchema } from '../portfolios/schemas/portfolio.schema';
import { KafkaConsumerService } from './kafka-consumer.service';
import { KafkaProducerService } from './kafka-producer.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: Portfolio.name, schema: PortfolioSchema }])],
  providers: [KafkaProducerService, KafkaConsumerService],
  exports: [KafkaProducerService],
})
export class KafkaModule {}
