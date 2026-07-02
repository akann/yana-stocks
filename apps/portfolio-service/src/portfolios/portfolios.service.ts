import { Injectable, NotFoundException } from '@nestjs/common';
import type { AddStockDto, CreatePortfolioDto } from '@yana-stocks/shared-dto';
import type { Portfolio as PortfolioType, PortfolioStock } from '@yana-stocks/shared-types';
import type { AuthUser } from '../common/current-user.decorator';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { TradeRepository } from '../trades/trade.repository';
import { UpdatePortfolioDto } from './dto/update-portfolio.dto';
import { PortfolioRepository } from './portfolio.repository';
import { Portfolio, PortfolioDocument } from './schemas/portfolio.schema';

@Injectable()
export class PortfoliosService {
  constructor(
    private readonly repo: PortfolioRepository,
    private readonly tradeRepo: TradeRepository,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  async findAll(): Promise<PortfolioType[]> {
    const docs = await this.repo.findAll();
    return docs.map((d) => this.toResponse(d));
  }

  async findOne(id: string): Promise<PortfolioType> {
    const doc = await this.repo.findById(id);
    if (!doc) throw new NotFoundException('Portfolio not found');
    return this.toResponse(doc);
  }

  async create(dto: CreatePortfolioDto, user: AuthUser): Promise<PortfolioType> {
    const doc = await this.repo.create(dto.name);
    const plain = doc.toObject() as Portfolio & {
      _id: { toString(): string };
      createdAt: Date;
      updatedAt: Date;
    };

    await this.kafkaProducer.emitPortfolioEvent({
      type: 'portfolio_created',
      portfolioId: plain._id.toString(),
      userId: user.id,
      payload: { name: dto.name },
      timestamp: new Date().toISOString(),
    });

    return this.toResponse(plain);
  }

  async update(id: string, dto: UpdatePortfolioDto): Promise<PortfolioType> {
    const doc = await this.repo.updateName(id, dto.name);
    if (!doc) throw new NotFoundException('Portfolio not found');
    return this.toResponse(doc);
  }

  async remove(id: string): Promise<void> {
    const result = await this.repo.delete(id);
    if (!result) throw new NotFoundException('Portfolio not found');
  }

  async addStock(id: string, dto: AddStockDto, user: AuthUser): Promise<PortfolioType> {
    const doc = await this.repo.findByIdForMutation(id);
    if (!doc) throw new NotFoundException('Portfolio not found');

    const existing = doc.stocks.find((s) => s.symbol === dto.symbol);
    if (existing) {
      const newShares = existing.shares + dto.shares;
      existing.avgCostBasis =
        (existing.shares * existing.avgCostBasis + dto.shares * dto.price) / newShares;
      existing.shares = newShares;
      // Seed only when no live price has streamed yet — streamed ticks stay authoritative
      existing.latestPrice ??= dto.price;
    } else {
      doc.stocks.push({
        symbol: dto.symbol,
        shares: dto.shares,
        avgCostBasis: dto.price,
        latestPrice: dto.price,
      });
    }

    const saved = await doc.save();

    await this.tradeRepo.record({
      portfolioId: id,
      symbol: dto.symbol,
      type: 'buy',
      shares: dto.shares,
      price: dto.price,
      totalAmount: dto.shares * dto.price,
      executedAt: new Date(),
    });

    await this.kafkaProducer.emitPortfolioEvent({
      type: 'stock_added',
      portfolioId: id,
      userId: user.id,
      payload: { symbol: dto.symbol, shares: dto.shares, price: dto.price },
      timestamp: new Date().toISOString(),
    });

    return this.toResponse(saved.toObject<Portfolio>());
  }

  private toResponse(
    doc: Portfolio & { _id?: { toString(): string }; id?: string },
  ): PortfolioType {
    const stocks: PortfolioStock[] = doc.stocks.map((s) => ({
      symbol: s.symbol,
      shares: s.shares,
      avgCostBasis: s.avgCostBasis,
      // Cost-basis fallback keeps valuations non-zero when no price has streamed
      // yet (market closed, pipeline down) — same rule the portfolio page applies
      currentValue: s.shares * (s.latestPrice ?? s.avgCostBasis),
    }));
    const totalValue = stocks.reduce((acc, s) => acc + (s.currentValue ?? 0), 0);
    return {
      id: doc.id ?? String(doc._id),
      userId: doc.userId,
      name: doc.name,
      stocks,
      totalValue: totalValue > 0 ? totalValue : undefined,
      createdAt: (doc as unknown as PortfolioDocument).createdAt ?? new Date(),
      updatedAt: (doc as unknown as PortfolioDocument).updatedAt ?? new Date(),
    };
  }
}
