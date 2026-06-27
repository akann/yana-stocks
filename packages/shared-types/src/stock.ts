import { ApiProperty } from '@nestjs/swagger';

export interface Stock {
  symbol: string;
  name: string;
  exchange: string;
}

export type OHLCVInterval = '1m' | '5m' | '15m' | '1h' | '1d';

export class OHLCV {
  @ApiProperty({ example: 'AAPL' })
  symbol!: string;

  @ApiProperty({ example: '2024-01-15T16:00:00.000Z' })
  timestamp!: Date;

  @ApiProperty({ example: 180.0 })
  open!: number;

  @ApiProperty({ example: 183.5 })
  high!: number;

  @ApiProperty({ example: 179.5 })
  low!: number;

  @ApiProperty({ example: 182.5 })
  close!: number;

  @ApiProperty({ example: 54321000 })
  volume!: number;

  @ApiProperty({ enum: ['1m', '5m', '15m', '1h', '1d'], example: '1d' })
  interval!: OHLCVInterval;
}

export interface StockPrice {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  volume: number;
  timestamp: Date;
}
