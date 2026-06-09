export interface PortfolioStock {
  symbol: string;
  shares: number;
  avgCostBasis: number;
  currentValue?: number;
}

export interface Portfolio {
  id: string;
  userId: string;
  name: string;
  stocks: PortfolioStock[];
  totalValue?: number;
  createdAt: Date;
  updatedAt: Date;
}

export type TradeType = 'buy' | 'sell';

export interface Trade {
  id: string;
  portfolioId: string;
  userId: string;
  symbol: string;
  type: TradeType;
  shares: number;
  price: number;
  totalAmount: number;
  executedAt: Date;
}

export interface Watchlist {
  id: string;
  userId: string;
  name: string;
  symbols: string[];
  createdAt: Date;
  updatedAt: Date;
}
