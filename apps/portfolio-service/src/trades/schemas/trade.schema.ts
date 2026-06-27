import { ApiProperty } from '@nestjs/swagger';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { TradeType } from '@yana-stocks/shared-types';

@Schema({ collection: 'trades', timestamps: false })
export class Trade {
  @ApiProperty({ example: 'portfolio-uuid-123' })
  @Prop({ required: true })
  portfolioId!: string;

  @ApiProperty({ example: 'user-uuid-123' })
  @Prop({ required: true })
  userId!: string;

  @ApiProperty({ example: 'AAPL' })
  @Prop({ required: true })
  symbol!: string;

  @ApiProperty({ enum: ['buy', 'sell'], example: 'buy' })
  @Prop({ required: true, enum: ['buy', 'sell'] })
  type!: TradeType;

  @ApiProperty({ example: 10 })
  @Prop({ required: true })
  shares!: number;

  @ApiProperty({ example: 182.5 })
  @Prop({ required: true })
  price!: number;

  @ApiProperty({ example: 1825.0, description: 'shares × price' })
  @Prop({ required: true })
  totalAmount!: number;

  @ApiProperty()
  @Prop({ required: true, default: () => new Date() })
  executedAt!: Date;
}

export const TradeSchema = SchemaFactory.createForClass(Trade);
TradeSchema.index({ userId: 1, executedAt: -1 });
TradeSchema.index({ userId: 1, portfolioId: 1, executedAt: -1 });
