import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OHLCV, PredictionSignal, SentimentSignal } from '@yana-stocks/shared-types';
import { firstValueFrom } from 'rxjs';

interface PolygonTickerResult {
  ticker?: string;
  name?: string;
  primary_exchange?: string;
}

interface PolygonTickersResponse {
  results?: PolygonTickerResult[];
}
import { RedisService } from '../redis/redis.service';
import { MOCK_ASSETS, MOCK_ETF_ASSETS } from './mock-assets';
import type {
  AggregateStockResponse,
  AssetEntry,
  AssetMarket,
  AssetsPage,
  MarketMovers,
  MoverEntry,
  PriceCacheEntry,
} from './price-cache.types';

const DEFAULT_SYMBOLS = [
  'AAPL',
  'MSFT',
  'GOOGL',
  'AMZN',
  'META',
  'TSLA',
  'NVDA',
  'NFLX',
  'AMD',
  'JPM',
  'V',
  'JNJ',
  'UNH',
  'XOM',
  'BAC',
];

@Injectable()
export class StocksService {
  private readonly logger = new Logger(StocksService.name);
  private readonly priceProcessorUrl: string;

  constructor(
    private readonly redis: RedisService,
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
  ) {
    this.priceProcessorUrl = config.getOrThrow<string>('priceProcessorUrl');
  }

  async getStock(symbol: string): Promise<AggregateStockResponse> {
    const [priceRaw, sentimentRaw, predictionRaw] = await Promise.all([
      this.redis.get(`papi:price:${symbol}`),
      this.redis.get(`papi:sentiment:${symbol}`),
      this.redis.get(`papi:prediction:${symbol}`),
    ]);

    let price = priceRaw ? (JSON.parse(priceRaw) as PriceCacheEntry) : null;

    if (!price) {
      try {
        const resp = await firstValueFrom(
          this.httpService.get<PriceCacheEntry>(`${this.priceProcessorUrl}/prices/${symbol}/quote`),
        );
        if (resp.data?.price) {
          price = resp.data;
          await this.redis.set(`papi:price:${symbol}`, JSON.stringify(price), 900);
        }
      } catch {
        // quote unavailable — price stays null
      }
    }

    const sentiment = sentimentRaw ? (JSON.parse(sentimentRaw) as SentimentSignal) : null;
    const prediction = predictionRaw ? (JSON.parse(predictionRaw) as PredictionSignal) : null;

    return {
      symbol,
      price: price?.price ?? null,
      change: price?.change ?? null,
      changePercent: price?.changePercent ?? null,
      volume: price?.volume ?? null,
      timestamp: price?.timestamp ?? null,
      sentiment,
      prediction,
    };
  }

  async getHistory(symbol: string, limit = 100, interval = '1m'): Promise<OHLCV[]> {
    const cacheKey = `papi:history:${symbol}:${limit}:${interval}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as OHLCV[];

    const response = await firstValueFrom(
      this.httpService.get<OHLCV[]>(
        `${this.priceProcessorUrl}/prices/${symbol}/history?limit=${limit}&interval=${interval}`,
      ),
    );

    await this.redis.set(cacheKey, JSON.stringify(response.data), 30);
    return response.data;
  }

  async getMovers(top = 5): Promise<MarketMovers> {
    const cacheKey = 'papi:movers';
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as MarketMovers;

    const priceKeys = DEFAULT_SYMBOLS.map((s) => `papi:price:${s}`);
    const existing = await this.redis.mget(priceKeys);
    const missing = DEFAULT_SYMBOLS.filter((_, i) => !existing[i]);
    if (missing.length) {
      await Promise.allSettled(missing.map((s) => this.getStock(s)));
    }

    const keys = await this.redis.scan('papi:price:*');
    if (!keys.length) return { gainers: [], losers: [] };

    const values = await this.redis.mget(keys);
    const entries: MoverEntry[] = keys.flatMap((key, i) => {
      const raw = values[i];
      if (!raw) return [];
      const entry = JSON.parse(raw) as PriceCacheEntry;
      const symbol = key.replace('papi:price:', '');
      return [
        {
          symbol,
          price: entry.price,
          change: entry.change,
          changePercent: entry.changePercent,
          volume: entry.volume,
        },
      ];
    });

    entries.sort((a, b) => b.changePercent - a.changePercent);
    const movers: MarketMovers = {
      gainers: entries.slice(0, top),
      losers: entries.slice(-top).reverse(),
    };

    await this.redis.set(cacheKey, JSON.stringify(movers), 10);
    return movers;
  }

  async getAssets(
    search: string,
    page: number,
    limit: number,
    market: AssetMarket = 'us',
  ): Promise<AssetsPage> {
    const CACHE_KEY = `papi:assets:${market}`;
    const CACHE_TTL = 86400;

    let all: AssetEntry[];
    const cached = await this.redis.get(CACHE_KEY);
    if (cached) {
      all = JSON.parse(cached) as AssetEntry[];
    } else {
      all = await this.fetchAssetsFromMassive(market === 'etf' ? 'ETF' : 'CS');
      await this.redis.set(CACHE_KEY, JSON.stringify(all), CACHE_TTL);
    }

    const q = search.trim();
    const filtered = q
      ? all.filter(
          (a) =>
            a.symbol.includes(q.toUpperCase()) || a.name.toLowerCase().includes(q.toLowerCase()),
        )
      : all;

    const start = (page - 1) * limit;
    return {
      data: filtered.slice(start, start + limit),
      total: filtered.length,
      page,
      limit,
    };
  }

  private async fetchAssetsFromMassive(type: 'CS' | 'ETF'): Promise<AssetEntry[]> {
    const assetClass: 'us_equity' | 'us_etf' = type === 'ETF' ? 'us_etf' : 'us_equity';
    const apiKey = this.config.get<string>('massiveApiKey') ?? '';

    if (!apiKey) {
      this.logger.warn('MASSIVE_API_KEY not set — using curated dev asset list');
      return type === 'ETF' ? MOCK_ETF_ASSETS : MOCK_ASSETS;
    }

    try {
      const resp = await firstValueFrom(
        this.httpService.get<PolygonTickersResponse>(
          'https://api.polygon.io/v3/reference/tickers',
          { params: { type, market: 'stocks', active: true, limit: 1000, apiKey } },
        ),
      );

      return (resp.data.results ?? [])
        .filter(
          (t): t is PolygonTickerResult & { ticker: string; name: string } =>
            typeof t.ticker === 'string' &&
            t.ticker !== '' &&
            typeof t.name === 'string' &&
            t.name !== '',
        )
        .map((t) => ({
          symbol: t.ticker,
          name: t.name,
          exchange: t.primary_exchange ?? '',
          tradable: true,
          assetClass,
        }));
    } catch (err) {
      this.logger.error(`Massive assets fetch failed, falling back to dev list: ${String(err)}`);
      return type === 'ETF' ? MOCK_ETF_ASSETS : MOCK_ASSETS;
    }
  }
}
