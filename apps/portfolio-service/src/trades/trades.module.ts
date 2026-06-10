import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TradesController } from './trades.controller';
import { TradesService } from './trades.service';
import { Trade, TradeSchema } from './schemas/trade.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: Trade.name, schema: TradeSchema }])],
  controllers: [TradesController],
  providers: [TradesService],
  exports: [TradesService],
})
export class TradesModule {}
