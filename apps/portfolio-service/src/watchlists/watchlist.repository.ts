import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { AuthUser } from '../common/current-user.decorator';
import { Watchlist, WatchlistDocument } from './schemas/watchlist.schema';

type RequestWithUser = { user: AuthUser };

@Injectable({ scope: Scope.REQUEST })
export class WatchlistRepository {
  private readonly userId: string;

  constructor(
    @InjectModel(Watchlist.name) private readonly model: Model<Watchlist>,
    @Inject(REQUEST) request: RequestWithUser,
  ) {
    this.userId = request.user.id;
  }

  findAll(): Promise<Watchlist[]> {
    return this.model.find({ userId: this.userId }).lean<Watchlist[]>().exec();
  }

  findById(id: string): Promise<Watchlist | null> {
    return this.model.findOne({ _id: id, userId: this.userId }).lean<Watchlist>().exec();
  }

  async create(name: string, symbols: string[]): Promise<Watchlist> {
    const doc = await this.model.create({ userId: this.userId, name, symbols });
    return doc.toObject<Watchlist>();
  }

  addSymbol(id: string, symbol: string): Promise<Watchlist | null> {
    return this.model
      .findOneAndUpdate(
        { _id: id, userId: this.userId },
        { $addToSet: { symbols: symbol } },
        { new: true },
      )
      .lean<Watchlist>()
      .exec();
  }

  removeSymbol(id: string, symbol: string): Promise<Watchlist | null> {
    return this.model
      .findOneAndUpdate(
        { _id: id, userId: this.userId },
        { $pull: { symbols: symbol } },
        { new: true },
      )
      .lean<Watchlist>()
      .exec();
  }

  delete(id: string): Promise<WatchlistDocument | null> {
    return this.model.findOneAndDelete({ _id: id, userId: this.userId }).exec();
  }
}
