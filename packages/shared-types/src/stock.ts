export interface Stock {
  symbol: string;
  name: string;
  exchange: string;
}

export type OHLCVInterval = '1m' | '5m' | '15m' | '1h' | '1d';

export interface OHLCV {
  symbol: string;
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  interval: OHLCVInterval;
}

export interface StockPrice {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  volume: number;
  timestamp: Date;
}
