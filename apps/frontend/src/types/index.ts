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

export type AssetMarket = 'us' | 'etf' | 'uk' | 'global';

export interface AssetEntry {
  symbol: string;
  name: string;
  exchange: string;
  tradable: boolean;
  assetClass: 'us_equity' | 'us_etf' | 'uk_equity';
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

export interface IndexQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changesPercentage: number;
}

export interface SectorPerformance {
  sector: string;
  changesPercentage: number;
}

export interface MarketNewsItem {
  title: string;
  url: string;
  publishedAt: string;
  source: string;
  summary: string;
}

export interface MarketOverview {
  indices: IndexQuote[];
  sectors: SectorPerformance[];
  news: MarketNewsItem[];
}

export interface FactorTile {
  factor: string;
  etf: string;
  price: number;
  change1d: number;
  change1w: number;
  change1m: number;
}

export interface SectorRotationRow {
  sector: string;
  changes: number[];
}

export interface SectorRotationData {
  dates: string[];
  rows: SectorRotationRow[];
}

export interface ScreenerResult {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changesPercentage: number;
  marketCap: number;
  sector: string;
  volume: number;
  dividendYield: number;
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
