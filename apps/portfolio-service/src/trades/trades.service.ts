import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Trade as TradeType } from '@yana-stocks/shared-types';
import { Model } from 'mongoose';
import { Trade } from './schemas/trade.schema';

@Injectable()
export class TradesService {
  constructor(@InjectModel(Trade.name) private readonly tradeModel: Model<Trade>) {}

  async findAllByUser(userId: string): Promise<TradeType[]> {
    const docs = await this.tradeModel
      .find({ userId })
      .sort({ executedAt: -1 })
      .lean<Trade[]>()
      .exec();
    return docs.map((d) => ({
      id: String((d as Trade & { _id: unknown })._id),
      portfolioId: d.portfolioId,
      userId: d.userId,
      symbol: d.symbol,
      type: d.type,
      shares: d.shares,
      price: d.price,
      totalAmount: d.totalAmount,
      executedAt: d.executedAt,
    }));
  }
}
