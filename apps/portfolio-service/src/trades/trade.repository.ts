import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import type { TradeType } from '@yana-stocks/shared-types';
import { Model } from 'mongoose';
import type { AuthUser } from '../common/current-user.decorator';
import { Trade } from './schemas/trade.schema';

type RequestWithUser = { user: AuthUser };

export interface RecordTradeInput {
  portfolioId: string;
  symbol: string;
  type: TradeType;
  shares: number;
  price: number;
  totalAmount: number;
  executedAt: Date;
}

@Injectable({ scope: Scope.REQUEST })
export class TradeRepository {
  private readonly userId: string;

  constructor(
    @InjectModel(Trade.name) private readonly model: Model<Trade>,
    @Inject(REQUEST) request: RequestWithUser,
  ) {
    this.userId = request.user.id;
  }

  findAll(): Promise<(Trade & { _id: unknown })[]> {
    return this.model
      .find({ userId: this.userId })
      .sort({ executedAt: -1 })
      .lean<(Trade & { _id: unknown })[]>()
      .exec();
  }

  async record(input: RecordTradeInput): Promise<void> {
    await this.model.create({ ...input, userId: this.userId });
  }
}
