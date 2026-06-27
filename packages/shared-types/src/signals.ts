import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type SentimentLabel = 'positive' | 'negative' | 'neutral';
export type PredictionHorizon = '1h' | '4h' | '1d' | '1w';

export class SentimentSignal {
  @ApiProperty({ example: 'AAPL' })
  symbol!: string;

  @ApiProperty({ example: 0.85, description: 'FinBERT confidence score 0–1' })
  score!: number;

  @ApiProperty({ enum: ['positive', 'negative', 'neutral'], example: 'positive' })
  label!: SentimentLabel;

  @ApiProperty({ example: 'Reuters' })
  source!: string;

  @ApiProperty({ example: 'Apple reports record earnings for Q4' })
  headline!: string;

  @ApiPropertyOptional({ example: 'https://example.com/article' })
  articleUrl?: string;

  @ApiProperty({ example: '2024-01-15T12:00:00.000Z' })
  publishedAt!: Date;

  @ApiProperty({ example: '2024-01-15T12:01:00.000Z' })
  analyzedAt!: Date;
}

export class PredictionSignal {
  @ApiProperty({ example: 'AAPL' })
  symbol!: string;

  @ApiProperty({ example: 182.5 })
  currentPrice!: number;

  @ApiProperty({ example: 188.0 })
  predictedPrice!: number;

  @ApiProperty({ example: 0.72, description: 'Model confidence 0–1' })
  confidence!: number;

  @ApiProperty({ enum: ['1h', '4h', '1d', '1w'], example: '1d' })
  horizon!: PredictionHorizon;

  @ApiProperty({ example: 'lstm-v2' })
  model!: string;

  @ApiProperty({ example: '2024-01-15T12:05:00.000Z' })
  generatedAt!: Date;
}
