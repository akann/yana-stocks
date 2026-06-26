export interface PriceCacheEntry {
  price: number;
  prevPrice: number;
  change: number;
  changePercent: number;
  volume: number;
  timestamp: string;
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

export interface StockResponse {
  symbol: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  timestamp: string | null;
}

export interface AggregateStockResponse extends StockResponse {
  sentiment: import('@yana-stocks/shared-types').SentimentSignal | null;
  prediction: import('@yana-stocks/shared-types').PredictionSignal | null;
}

export interface AssetEntry {
  symbol: string;
  name: string;
  exchange: string;
  tradable: boolean;
  assetClass: 'us_equity' | 'us_etf' | 'uk_equity';
}

export type AssetMarket = 'us' | 'etf' | 'uk';

export interface AssetsPage {
  data: AssetEntry[];
  total: number;
  page: number;
  limit: number;
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
