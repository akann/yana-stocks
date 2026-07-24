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
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: string; // bar start (UTC ISO)
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
