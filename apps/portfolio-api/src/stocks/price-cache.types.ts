import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SentimentSignal, PredictionSignal } from '@yana-stocks/shared-types';

export class PriceCacheEntry {
  @ApiProperty({ example: 182.5 })
  price!: number;
  @ApiProperty({ example: 180.0 })
  prevPrice!: number;
  @ApiProperty({ example: 2.5 })
  change!: number;
  @ApiProperty({ example: 1.39 })
  changePercent!: number;
  @ApiProperty({ example: 54321000 })
  volume!: number;
  @ApiProperty({ example: '2024-01-15T16:00:00.000Z' })
  timestamp!: string;
}

export class MoverEntry {
  @ApiProperty({ example: 'AAPL' })
  symbol!: string;
  @ApiProperty({ example: 182.5 })
  price!: number;
  @ApiProperty({ example: 2.5 })
  change!: number;
  @ApiProperty({ example: 1.39 })
  changePercent!: number;
  @ApiProperty({ example: 54321000 })
  volume!: number;
}

export class MarketMovers {
  @ApiProperty({ type: [MoverEntry] })
  gainers!: MoverEntry[];
  @ApiProperty({ type: [MoverEntry] })
  losers!: MoverEntry[];
}

export class StockResponse {
  @ApiProperty({ example: 'AAPL' })
  symbol!: string;
  @ApiPropertyOptional({ example: 182.5, nullable: true })
  price!: number | null;
  @ApiPropertyOptional({ example: 2.5, nullable: true })
  change!: number | null;
  @ApiPropertyOptional({ example: 1.39, nullable: true })
  changePercent!: number | null;
  @ApiPropertyOptional({ example: 54321000, nullable: true })
  volume!: number | null;
  @ApiPropertyOptional({ example: '2024-01-15T16:00:00.000Z', nullable: true })
  timestamp!: string | null;
}

export class AggregateStockResponse extends StockResponse {
  @ApiPropertyOptional({
    type: () => SentimentSignal,
    nullable: true,
    description: 'Latest sentiment signal from FinBERT',
  })
  sentiment!: SentimentSignal | null;
  @ApiPropertyOptional({
    type: () => PredictionSignal,
    nullable: true,
    description: 'Latest price prediction from ml-predictor',
  })
  prediction!: PredictionSignal | null;
}

export class AssetEntry {
  @ApiProperty({ example: 'AAPL' })
  symbol!: string;
  @ApiProperty({ example: 'Apple Inc.' })
  name!: string;
  @ApiProperty({ example: 'NASDAQ' })
  exchange!: string;
  @ApiProperty({ example: true })
  tradable!: boolean;
  @ApiProperty({ enum: ['us_equity', 'us_etf', 'uk_equity', 'intl_equity'], example: 'us_equity' })
  assetClass!: 'us_equity' | 'us_etf' | 'uk_equity' | 'intl_equity';
}

export type AssetMarket = 'us' | 'etf' | 'uk' | 'global';

export class AssetsPage {
  @ApiProperty({ type: [AssetEntry] })
  data!: AssetEntry[];
  @ApiProperty({ example: 3452 })
  total!: number;
  @ApiProperty({ example: 1 })
  page!: number;
  @ApiProperty({ example: 20 })
  limit!: number;
}

export class IndexQuote {
  @ApiProperty({ example: 'SPY' })
  symbol!: string;
  @ApiProperty({ example: 'S&P 500 ETF' })
  name!: string;
  @ApiProperty({ example: 472.5 })
  price!: number;
  @ApiProperty({ example: 3.21 })
  change!: number;
  @ApiProperty({ example: 0.68 })
  changesPercentage!: number;
}

export class SectorPerformance {
  @ApiProperty({ example: 'Technology' })
  sector!: string;
  @ApiProperty({ example: 1.23 })
  changesPercentage!: number;
}

export class MarketNewsItem {
  @ApiProperty({ example: 'Fed holds rates steady' })
  title!: string;
  @ApiProperty({ example: 'https://example.com/article' })
  url!: string;
  @ApiProperty({ example: '2024-01-15T12:00:00.000Z' })
  publishedAt!: string;
  @ApiProperty({ example: 'Reuters' })
  source!: string;
  @ApiProperty({ example: 'The Federal Reserve kept interest rates unchanged...' })
  summary!: string;
}

export class MarketOverview {
  @ApiProperty({ type: [IndexQuote] })
  indices!: IndexQuote[];
  @ApiProperty({ type: [SectorPerformance] })
  sectors!: SectorPerformance[];
  @ApiProperty({ type: [MarketNewsItem] })
  news!: MarketNewsItem[];
}

export class FactorTile {
  @ApiProperty({ example: 'Momentum' })
  factor!: string;
  @ApiProperty({ example: 'MTUM' })
  etf!: string;
  @ApiProperty({ example: 182.5 })
  price!: number;
  @ApiProperty({ example: 0.45, description: '1-day % change' })
  change1d!: number;
  @ApiProperty({ example: 1.2, description: '1-week % change' })
  change1w!: number;
  @ApiProperty({ example: 3.4, description: '1-month % change' })
  change1m!: number;
}

export class SectorRotationRow {
  @ApiProperty({ example: 'Technology' })
  sector!: string;
  @ApiProperty({ type: [Number], example: [1.2, -0.3, 0.8] })
  changes!: number[];
}

export class SectorRotationData {
  @ApiProperty({ type: [String], example: ['2024-01-08', '2024-01-15'] })
  dates!: string[];
  @ApiProperty({ type: [SectorRotationRow] })
  rows!: SectorRotationRow[];
}

export class ScreenerResult {
  @ApiProperty({ example: 'AAPL' })
  symbol!: string;
  @ApiProperty({ example: 'Apple Inc.' })
  name!: string;
  @ApiProperty({ example: 182.5 })
  price!: number;
  @ApiProperty({ example: 2.5 })
  change!: number;
  @ApiProperty({ example: 1.39 })
  changesPercentage!: number;
  @ApiProperty({ example: 2900000000000 })
  marketCap!: number;
  @ApiProperty({ example: 'Technology' })
  sector!: string;
  @ApiProperty({ example: 54321000 })
  volume!: number;
  @ApiProperty({ example: 0.58 })
  dividendYield!: number;
}
