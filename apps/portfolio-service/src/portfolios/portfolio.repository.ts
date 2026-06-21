import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { AuthUser } from '../common/current-user.decorator';
import { Portfolio, PortfolioDocument } from './schemas/portfolio.schema';

type RequestWithUser = { user: AuthUser };

@Injectable({ scope: Scope.REQUEST })
export class PortfolioRepository {
  private readonly userId: string;

  constructor(
    @InjectModel(Portfolio.name) private readonly model: Model<Portfolio>,
    @Inject(REQUEST) request: RequestWithUser,
  ) {
    this.userId = request.user.id;
  }

  findAll(): Promise<Portfolio[]> {
    return this.model.find({ userId: this.userId }).lean<Portfolio[]>().exec();
  }

  findById(id: string): Promise<Portfolio | null> {
    return this.model.findOne({ _id: id, userId: this.userId }).lean<Portfolio>().exec();
  }

  create(name: string): Promise<PortfolioDocument> {
    return this.model.create({ userId: this.userId, name, stocks: [] });
  }

  updateName(id: string, name: string): Promise<Portfolio | null> {
    return this.model
      .findOneAndUpdate({ _id: id, userId: this.userId }, { $set: { name } }, { new: true })
      .lean<Portfolio>()
      .exec();
  }

  delete(id: string): Promise<PortfolioDocument | null> {
    return this.model.findOneAndDelete({ _id: id, userId: this.userId }).exec();
  }

  findByIdForMutation(id: string): Promise<PortfolioDocument | null> {
    return this.model.findOne({ _id: id, userId: this.userId }).exec();
  }
}
