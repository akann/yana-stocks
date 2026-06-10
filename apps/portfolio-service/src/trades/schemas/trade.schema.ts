import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { TradeType } from '@yana-stocks/shared-types';
import { HydratedDocument } from 'mongoose';

export type TradeDocument = HydratedDocument<Trade>;

@Schema({ collection: 'trades', timestamps: false })
export class Trade {
  @Prop({ required: true, index: true })
  portfolioId!: string;

  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ required: true })
  symbol!: string;

  @Prop({ required: true, enum: ['buy', 'sell'] })
  type!: TradeType;

  @Prop({ required: true })
  shares!: number;

  @Prop({ required: true })
  price!: number;

  @Prop({ required: true })
  totalAmount!: number;

  @Prop({ required: true, default: () => new Date() })
  executedAt!: Date;
}

export const TradeSchema = SchemaFactory.createForClass(Trade);
