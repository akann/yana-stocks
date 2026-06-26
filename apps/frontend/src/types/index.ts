export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  isVerified: boolean;
}

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
  createdAt: string;
  updatedAt: string;
}

export interface Watchlist {
  id: string;
  userId: string;
  name: string;
  symbols: string[];
  createdAt: string;
  updatedAt: string;
}

export interface StockAggregate {
  symbol: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  timestamp: string | null;
  sentiment: SentimentSignal | null;
  prediction: PredictionSignal | null;
}

export interface OHLCVBar {
  symbol: string;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  interval: string;
}

export type SentimentLabel = 'positive' | 'negative' | 'neutral';

export interface SentimentSignal {
  symbol: string;
  score: number;
  label: SentimentLabel;
  source: string;
  headline: string;
  articleUrl?: string;
  publishedAt: string;
  analyzedAt: string;
}

export type PredictionHorizon = '1h' | '4h' | '1d' | '1w';

export interface PredictionSignal {
  symbol: string;
  currentPrice: number;
  predictedPrice: number;
  confidence: number;
  horizon: PredictionHorizon;
  model: string;
  generatedAt: string;
}

export type AssetMarket = 'us' | 'etf';

export interface AssetEntry {
  symbol: string;
  name: string;
  exchange: string;
  tradable: boolean;
  assetClass: 'us_equity' | 'us_etf';
}

export interface AssetsPage {
  data: AssetEntry[];
  total: number;
  page: number;
  limit: number;
}

export interface MoverEntry {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
}

export interface MarketMovers {
  gainers: MoverEntry[];
  losers: MoverEntry[];
}

export interface AnalystRating {
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
  analystCount: number;
  priceTarget: number | null;
  consensus: 'strongBuy' | 'buy' | 'hold' | 'sell' | 'strongSell' | null;
  asOf: string | null;
}
