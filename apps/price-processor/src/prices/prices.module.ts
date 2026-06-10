import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RedisModule } from '../redis/redis.module';
import { KafkaConsumerService } from './kafka-consumer.service';
import { KafkaProducerService } from './kafka-producer.service';
import { PricesController } from './prices.controller';
import { PricesService } from './prices.service';
import { PriceBar, PriceBarSchema } from './schemas/price-bar.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: PriceBar.name, schema: PriceBarSchema }]),
    RedisModule,
  ],
  controllers: [PricesController],
  providers: [PricesService, KafkaProducerService, KafkaConsumerService],
})
export class PricesModule {}
