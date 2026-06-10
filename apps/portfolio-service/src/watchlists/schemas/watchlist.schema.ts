import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type WatchlistDocument = HydratedDocument<Watchlist>;

@Schema({ collection: 'watchlists', timestamps: true })
export class Watchlist {
  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ required: true })
  name!: string;

  @Prop({ type: [String], default: [] })
  symbols!: string[];

  createdAt!: Date;
  updatedAt!: Date;
}

export const WatchlistSchema = SchemaFactory.createForClass(Watchlist);
