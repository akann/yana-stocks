import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ _id: false })
export class PortfolioHolding {
  @ApiProperty({ example: 'AAPL' })
  @Prop({ required: true })
  symbol!: string;

  @ApiProperty({ example: 10 })
  @Prop({ required: true })
  shares!: number;

  @ApiProperty({ example: 175.0, description: 'Average cost basis per share' })
  @Prop({ required: true })
  avgCostBasis!: number;

  @ApiPropertyOptional({ example: 182.5, description: 'Latest market price per share' })
  @Prop()
  latestPrice?: number;
}

export const PortfolioHoldingSchema = SchemaFactory.createForClass(PortfolioHolding);

export type PortfolioDocument = HydratedDocument<Portfolio>;

@Schema({ collection: 'portfolios', timestamps: true })
export class Portfolio {
  @ApiProperty({ example: 'user-uuid-123' })
  @Prop({ required: true })
  userId!: string;

  @ApiProperty({ example: 'My ISA Portfolio' })
  @Prop({ required: true })
  name!: string;

  @ApiProperty({ type: [PortfolioHolding] })
  @Prop({ type: [PortfolioHoldingSchema], default: [] })
  stocks!: PortfolioHolding[];

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export const PortfolioSchema = SchemaFactory.createForClass(Portfolio);
PortfolioSchema.index({ userId: 1, _id: 1 });
