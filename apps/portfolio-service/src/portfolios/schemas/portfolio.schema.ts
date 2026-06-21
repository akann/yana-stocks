import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ _id: false })
export class PortfolioHolding {
  @Prop({ required: true })
  symbol!: string;

  @Prop({ required: true })
  shares!: number;

  @Prop({ required: true })
  avgCostBasis!: number;

  @Prop()
  latestPrice?: number;
}

export const PortfolioHoldingSchema = SchemaFactory.createForClass(PortfolioHolding);

export type PortfolioDocument = HydratedDocument<Portfolio>;

@Schema({ collection: 'portfolios', timestamps: true })
export class Portfolio {
  @Prop({ required: true })
  userId!: string;

  @Prop({ required: true })
  name!: string;

  @Prop({ type: [PortfolioHoldingSchema], default: [] })
  stocks!: PortfolioHolding[];

  createdAt!: Date;
  updatedAt!: Date;
}

export const PortfolioSchema = SchemaFactory.createForClass(Portfolio);
PortfolioSchema.index({ userId: 1, _id: 1 });
