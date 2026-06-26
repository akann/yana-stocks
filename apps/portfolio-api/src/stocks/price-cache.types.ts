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
