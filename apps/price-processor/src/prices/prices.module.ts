import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import axios from 'axios';
import { RedisModule } from '../redis/redis.module';
import { KafkaConsumerService } from './kafka-consumer.service';
import { KafkaProducerService } from './kafka-producer.service';
import { PricesController } from './prices.controller';
import { POLYGON_HTTP, PricesService } from './prices.service';
import { PriceBar, PriceBarSchema } from './schemas/price-bar.schema';
import { TwelveDataService } from './twelve-data.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: PriceBar.name, schema: PriceBarSchema }]),
    RedisModule,
  ],
  controllers: [PricesController],
  providers: [
    PricesService,
    TwelveDataService,
    KafkaProducerService,
    KafkaConsumerService,
    {
      provide: POLYGON_HTTP,
      useValue: axios.create({ baseURL: 'https://api.polygon.io' }),
    },
  ],
})
export class PricesModule {}
