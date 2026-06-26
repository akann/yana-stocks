import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { RedisService } from '../redis/redis.service';
import type { AnalystRating } from './analyst.types';

const FMP_STABLE = 'https://financialmodelingprep.com/stable';
const FMP_V4 = 'https://financialmodelingprep.com/api/v4';
const CACHE_TTL = 86_400; // 24 h

interface FmpRecommendation {
  symbol?: string;
  date?: string;
  // v3 analyst-stock-recommendations field names
  analystRatingsStrongBuy?: number;
  analystRatingsBuy?: number;
  analystRatingsbuy?: number; // FMP quirk: lowercase 'b' in some API versions
  analystRatingsHold?: number;
  analystRatingsSell?: number;
  analystRatingsStrongSell?: number;
  // stable/analyst-consensus field names
  strongBuy?: number;
  buy?: number;
  hold?: number;
  sell?: number;
  strongSell?: number;
}

interface FmpPriceTarget {
  symbol?: string;
  targetHigh?: number;
  targetLow?: number;
  targetConsensus?: number;
  targetMedian?: number;
}

const EMPTY: AnalystRating = {
  strongBuy: 0,
  buy: 0,
  hold: 0,
  sell: 0,
  strongSell: 0,
  analystCount: 0,
  priceTarget: null,
  consensus: null,
  asOf: null,
};

@Injectable()
export class AnalystService {
  private readonly logger = new Logger(AnalystService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
  ) {}

  async getRatings(symbol: string): Promise<AnalystRating> {
    const CACHE_KEY = `papi:analyst:${symbol}`;
    const cached = await this.redis.get(CACHE_KEY);
    if (cached) return JSON.parse(cached) as AnalystRating;

    const apiKey = this.config.get<string>('fmpApiKey') ?? '';
    if (!apiKey) {
      this.logger.warn('FMP_API_KEY not set — returning empty analyst rating');
      return { ...EMPTY };
    }

    const [recResult, targetResult] = await Promise.allSettled([
      firstValueFrom(
        this.httpService.get<FmpRecommendation[]>(
          `${FMP_STABLE}/analyst-consensus?symbol=${symbol}&limit=1&apikey=${apiKey}`,
        ),
      ),
      firstValueFrom(
        this.httpService.get<FmpPriceTarget | FmpPriceTarget[]>(
          `${FMP_V4}/price-target-consensus?symbol=${symbol}&apikey=${apiKey}`,
        ),
      ),
    ]);

    const rec: FmpRecommendation =
      recResult.status === 'fulfilled' && Array.isArray(recResult.value.data)
        ? (recResult.value.data[0] ?? {})
        : {};

    const rawTarget = targetResult.status === 'fulfilled' ? targetResult.value.data : null;
    const target: FmpPriceTarget = Array.isArray(rawTarget)
      ? (rawTarget[0] ?? {})
      : (rawTarget ?? {});

    // Support both stable field names (strongBuy) and v3 names (analystRatingsStrongBuy)
    const strongBuy = rec.strongBuy ?? rec.analystRatingsStrongBuy ?? 0;
    const buy = rec.buy ?? rec.analystRatingsBuy ?? rec.analystRatingsbuy ?? 0;
    const hold = rec.hold ?? rec.analystRatingsHold ?? 0;
    const sell = rec.sell ?? rec.analystRatingsSell ?? 0;
    const strongSell = rec.strongSell ?? rec.analystRatingsStrongSell ?? 0;

    const rating: AnalystRating = {
      strongBuy,
      buy,
      hold,
      sell,
      strongSell,
      analystCount: strongBuy + buy + hold + sell + strongSell,
      priceTarget: target.targetConsensus ?? null,
      consensus: this.calcConsensus(strongBuy, buy, hold, sell, strongSell),
      asOf: rec.date ?? null,
    };

    // Only cache non-empty results; empty results retry on next request
    if (rating.analystCount > 0 || rating.priceTarget != null) {
      await this.redis.set(CACHE_KEY, JSON.stringify(rating), CACHE_TTL);
    }
    return rating;
  }

  private calcConsensus(
    strongBuy: number,
    buy: number,
    hold: number,
    sell: number,
    strongSell: number,
  ): AnalystRating['consensus'] {
    const pairs: Array<[AnalystRating['consensus'], number]> = [
      ['strongBuy', strongBuy],
      ['buy', buy],
      ['hold', hold],
      ['sell', sell],
      ['strongSell', strongSell],
    ];
    const total = pairs.reduce((s, [, v]) => s + v, 0);
    if (total === 0) return null;
    return pairs.reduce((best, curr) => (curr[1] > best[1] ? curr : best))[0];
  }
}
