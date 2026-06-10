import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { AddStockDto, CreatePortfolioDto } from '@yana-stocks/shared-dto';
import type { Portfolio as PortfolioType, PortfolioStock } from '@yana-stocks/shared-types';
import { Model } from 'mongoose';
import type { AuthUser } from '../common/current-user.decorator';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { Trade } from '../trades/schemas/trade.schema';
import { UpdatePortfolioDto } from './dto/update-portfolio.dto';
import { Portfolio, PortfolioDocument } from './schemas/portfolio.schema';

@Injectable()
export class PortfoliosService {
  constructor(
    @InjectModel(Portfolio.name) private readonly portfolioModel: Model<Portfolio>,
    @InjectModel(Trade.name) private readonly tradeModel: Model<Trade>,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  async findAll(userId: string): Promise<PortfolioType[]> {
    const docs = await this.portfolioModel.find({ userId }).lean<Portfolio[]>().exec();
    return docs.map((d) => this.toResponse(d));
  }

  async findOne(id: string, userId: string): Promise<PortfolioType> {
    const doc = await this.portfolioModel.findById(id).lean<Portfolio>().exec();
    if (!doc) throw new NotFoundException('Portfolio not found');
    if (doc.userId !== userId) throw new ForbiddenException();
    return this.toResponse(doc);
  }

  async create(dto: CreatePortfolioDto, user: AuthUser): Promise<PortfolioType> {
    const doc = await this.portfolioModel.create({ userId: user.id, name: dto.name, stocks: [] });
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

  async update(id: string, dto: UpdatePortfolioDto, userId: string): Promise<PortfolioType> {
    const doc = await this.portfolioModel
      .findOneAndUpdate({ _id: id, userId }, { $set: { name: dto.name } }, { new: true })
      .lean<Portfolio>()
      .exec();
    if (!doc) throw new NotFoundException('Portfolio not found');
    return this.toResponse(doc);
  }

  async remove(id: string, userId: string): Promise<void> {
    const result = await this.portfolioModel.findOneAndDelete({ _id: id, userId }).exec();
    if (!result) throw new NotFoundException('Portfolio not found');
  }

  async addStock(id: string, dto: AddStockDto, user: AuthUser): Promise<PortfolioType> {
    const doc = await this.portfolioModel.findById(id).exec();
    if (!doc) throw new NotFoundException('Portfolio not found');
    if (doc.userId !== user.id) throw new ForbiddenException();

    const existing = doc.stocks.find((s) => s.symbol === dto.symbol);
    if (existing) {
      const newShares = existing.shares + dto.shares;
      existing.avgCostBasis =
        (existing.shares * existing.avgCostBasis + dto.shares * dto.price) / newShares;
      existing.shares = newShares;
    } else {
      doc.stocks.push({ symbol: dto.symbol, shares: dto.shares, avgCostBasis: dto.price });
    }

    const saved = await doc.save();

    await this.tradeModel.create({
      portfolioId: id,
      userId: user.id,
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
      currentValue: s.latestPrice != null ? s.shares * s.latestPrice : undefined,
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
