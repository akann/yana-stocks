import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { KafkaModule } from '../kafka/kafka.module';
import { TradesModule } from '../trades/trades.module';
import { PortfolioRepository } from './portfolio.repository';
import { PortfoliosController } from './portfolios.controller';
import { PortfoliosService } from './portfolios.service';
import { Portfolio, PortfolioSchema } from './schemas/portfolio.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Portfolio.name, schema: PortfolioSchema }]),
    TradesModule,
    KafkaModule,
  ],
  controllers: [PortfoliosController],
  providers: [PortfolioRepository, PortfoliosService],
})
export class PortfoliosModule {}
