import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PriceBarDocument = HydratedDocument<PriceBar>;

@Schema({ collection: 'price_bars', timestamps: false })
export class PriceBar {
  @Prop({ required: true })
  symbol!: string;

  @Prop({ required: true })
  timestamp!: Date;

  @Prop({ required: true })
  open!: number;

  @Prop({ required: true })
  high!: number;

  @Prop({ required: true })
  low!: number;

  @Prop({ required: true })
  close!: number;

  @Prop({ required: true })
  volume!: number;

  @Prop({ default: '1m' })
  interval!: string;
}

export const PriceBarSchema = SchemaFactory.createForClass(PriceBar);
PriceBarSchema.index({ symbol: 1, timestamp: 1 }, { unique: true });
PriceBarSchema.index({ symbol: 1, interval: 1, timestamp: -1 });
