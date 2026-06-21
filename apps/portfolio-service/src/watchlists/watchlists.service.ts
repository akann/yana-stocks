import { Injectable, NotFoundException } from '@nestjs/common';
import type { Watchlist as WatchlistType } from '@yana-stocks/shared-types';
import { CreateWatchlistDto } from './dto/create-watchlist.dto';
import { WatchlistRepository } from './watchlist.repository';
import { Watchlist } from './schemas/watchlist.schema';

@Injectable()
export class WatchlistsService {
  constructor(private readonly repo: WatchlistRepository) {}

  async findAll(): Promise<WatchlistType[]> {
    const docs = await this.repo.findAll();
    return docs.map((d) => this.toResponse(d));
  }

  async findOne(id: string): Promise<WatchlistType> {
    const doc = await this.repo.findById(id);
    if (!doc) throw new NotFoundException('Watchlist not found');
    return this.toResponse(doc);
  }

  async create(dto: CreateWatchlistDto): Promise<WatchlistType> {
    const doc = await this.repo.create(dto.name, dto.symbols ?? []);
    return this.toResponse(doc);
  }

  async addSymbol(id: string, symbol: string): Promise<WatchlistType> {
    const doc = await this.repo.addSymbol(id, symbol.toUpperCase());
    if (!doc) throw new NotFoundException('Watchlist not found');
    return this.toResponse(doc);
  }

  async removeSymbol(id: string, symbol: string): Promise<WatchlistType> {
    const doc = await this.repo.removeSymbol(id, symbol.toUpperCase());
    if (!doc) throw new NotFoundException('Watchlist not found');
    return this.toResponse(doc);
  }

  async remove(id: string): Promise<void> {
    const result = await this.repo.delete(id);
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
