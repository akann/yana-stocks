import { Injectable } from '@nestjs/common';
import type { PredictionSignal, SentimentSignal } from '@yana-stocks/shared-types';
import { RedisService } from '../redis/redis.service';

export interface SignalsResponse {
  symbol: string;
  sentiment: SentimentSignal | null;
  prediction: PredictionSignal | null;
}

@Injectable()
export class SignalsService {
  constructor(private readonly redis: RedisService) {}

  async getSignals(symbol: string): Promise<SignalsResponse> {
    const [sentimentRaw, predictionRaw] = await Promise.all([
      this.redis.get(`papi:sentiment:${symbol}`),
      this.redis.get(`papi:prediction:${symbol}`),
    ]);

    return {
      symbol,
      sentiment: sentimentRaw ? (JSON.parse(sentimentRaw) as SentimentSignal) : null,
      prediction: predictionRaw ? (JSON.parse(predictionRaw) as PredictionSignal) : null,
    };
  }
}
