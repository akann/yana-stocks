export type SentimentLabel = 'positive' | 'negative' | 'neutral';
export type PredictionHorizon = '1h' | '4h' | '1d' | '1w';

export interface SentimentSignal {
  symbol: string;
  score: number;
  label: SentimentLabel;
  source: string;
  headline: string;
  articleUrl?: string;
  publishedAt: Date;
  analyzedAt: Date;
}

export interface PredictionSignal {
  symbol: string;
  currentPrice: number;
  predictedPrice: number;
  confidence: number;
  horizon: PredictionHorizon;
  model: string;
  generatedAt: Date;
}
