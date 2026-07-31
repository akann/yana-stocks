import { ApiProperty } from '@nestjs/swagger';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type WatchlistDocument = HydratedDocument<Watchlist>;

@Schema({ collection: 'watchlists', timestamps: true })
export class Watchlist {
  @ApiProperty({ example: 'user-uuid-123' })
  @Prop({ required: true })
  userId!: string;

  @ApiProperty({ example: 'Tech Watchlist' })
  @Prop({ required: true })
  name!: string;

  // Read directly (no API) via `.distinct('symbols')` by sentiment-analyzer
  // and ml-predictor's storage.py — renaming this field silently breaks their
  // tracked-symbol discovery. Update both if you rename it.
  @ApiProperty({ type: [String], example: ['AAPL', 'MSFT', 'GOOGL'] })
  @Prop({ type: [String], default: [] })
  symbols!: string[];

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export const WatchlistSchema = SchemaFactory.createForClass(Watchlist);
WatchlistSchema.index({ userId: 1, _id: 1 });
