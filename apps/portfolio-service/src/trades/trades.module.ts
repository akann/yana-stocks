import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TradeRepository } from './trade.repository';
import { TradesController } from './trades.controller';
import { TradesService } from './trades.service';
import { Trade, TradeSchema } from './schemas/trade.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: Trade.name, schema: TradeSchema }])],
  controllers: [TradesController],
  providers: [TradeRepository, TradesService],
  exports: [TradeRepository],
})
export class TradesModule {}
