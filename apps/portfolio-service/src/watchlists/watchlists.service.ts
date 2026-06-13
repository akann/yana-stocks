import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Watchlist as WatchlistType } from '@yana-stocks/shared-types';
import { Model } from 'mongoose';
import { CreateWatchlistDto } from './dto/create-watchlist.dto';
import { Watchlist } from './schemas/watchlist.schema';

@Injectable()
export class WatchlistsService {
  constructor(@InjectModel(Watchlist.name) private readonly watchlistModel: Model<Watchlist>) {}

  async findAll(userId: string): Promise<WatchlistType[]> {
    const docs = await this.watchlistModel.find({ userId }).lean<Watchlist[]>().exec();
    return docs.map((d) => this.toResponse(d));
  }

  async findOne(id: string, userId: string): Promise<WatchlistType> {
    const doc = await this.watchlistModel.findOne({ _id: id, userId }).lean<Watchlist>().exec();
    if (!doc) throw new NotFoundException('Watchlist not found');
    return this.toResponse(doc);
  }

  async create(dto: CreateWatchlistDto, userId: string): Promise<WatchlistType> {
    const doc = await this.watchlistModel.create({
      userId,
      name: dto.name,
      symbols: dto.symbols ?? [],
    });
    return this.toResponse(doc.toObject<Watchlist>());
  }

  async addSymbol(id: string, symbol: string, userId: string): Promise<WatchlistType> {
    const doc = await this.watchlistModel
      .findOneAndUpdate(
        { _id: id, userId },
        { $addToSet: { symbols: symbol.toUpperCase() } },
        { new: true },
      )
      .lean<Watchlist>()
      .exec();
    if (!doc) throw new NotFoundException('Watchlist not found');
    return this.toResponse(doc);
  }

  async removeSymbol(id: string, symbol: string, userId: string): Promise<WatchlistType> {
    const doc = await this.watchlistModel
      .findOneAndUpdate(
        { _id: id, userId },
        { $pull: { symbols: symbol.toUpperCase() } },
        { new: true },
      )
      .lean<Watchlist>()
      .exec();
    if (!doc) throw new NotFoundException('Watchlist not found');
    return this.toResponse(doc);
  }

  async remove(id: string, userId: string): Promise<void> {
    const result = await this.watchlistModel.findOneAndDelete({ _id: id, userId }).exec();
    if (!result) throw new NotFoundException('Watchlist not found');
  }

  private toResponse(doc: Watchlist & { _id?: unknown; id?: string }): WatchlistType {
    return {
      id: doc.id ?? String(doc._id),
      userId: doc.userId,
      name: doc.name,
      symbols: doc.symbols,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
