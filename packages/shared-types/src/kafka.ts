export interface KafkaMessage<T = unknown> {
  topic: string;
  partition: number;
  offset: string;
  timestamp: string;
  key: string;
  value: T;
}

export interface RawPriceMessage {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  volume: number;
  timestamp: string;
}

export interface ProcessedPriceMessage {
  symbol: string;
  price: number;
  ohlcv: {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  };
  timestamp: string;
}

export type PortfolioEventType =
  | 'portfolio_created'
  | 'portfolio_updated'
  | 'stock_added'
  | 'stock_removed'
  | 'trade_executed';

export interface PortfolioEventMessage {
  type: PortfolioEventType;
  portfolioId: string;
  userId: string;
  payload: Record<string, unknown>;
  timestamp: string;
}
