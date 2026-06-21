import { Injectable } from '@nestjs/common';
import type { Trade as TradeType } from '@yana-stocks/shared-types';
import { TradeRepository } from './trade.repository';

@Injectable()
export class TradesService {
  constructor(private readonly repo: TradeRepository) {}

  async findAll(): Promise<TradeType[]> {
    const docs = await this.repo.findAll();
    return docs.map((d) => ({
      id: String(d._id),
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
