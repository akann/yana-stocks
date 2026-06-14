import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OHLCV, PredictionSignal, SentimentSignal } from '@yana-stocks/shared-types';
import { firstValueFrom } from 'rxjs';
import { RedisService } from '../redis/redis.service';
import { MOCK_ASSETS } from './mock-assets';
import type {
  AggregateStockResponse,
  AssetEntry,
  AssetsPage,
  MarketMovers,
  MoverEntry,
  PriceCacheEntry,
} from './price-cache.types';

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
          this.httpService.get<PriceCacheEntry>(
            `${this.priceProcessorUrl}/prices/${symbol}/quote`,
          ),
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

  async getAssets(search: string, page: number, limit: number): Promise<AssetsPage> {
    const CACHE_KEY = 'papi:assets:all';
    const CACHE_TTL = 86400; // 24h — asset list barely changes

    let all: AssetEntry[];
    const cached = await this.redis.get(CACHE_KEY);
    if (cached) {
      all = JSON.parse(cached) as AssetEntry[];
    } else {
      all = await this.fetchAssetsFromAlpaca();
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

  private async fetchAssetsFromAlpaca(): Promise<AssetEntry[]> {
    const apiKey = this.config.get<string>('alpaca.apiKey') ?? '';
    const apiSecret = this.config.get<string>('alpaca.apiSecret') ?? '';

    if (!apiKey || !apiSecret) {
      this.logger.warn('ALPACA_API_KEY / ALPACA_API_SECRET not set — using curated dev asset list');
      return MOCK_ASSETS;
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get<AlpacaAsset[]>('https://paper-api.alpaca.markets/v2/assets', {
          params: { status: 'active', asset_class: 'us_equity' },
          headers: {
            'APCA-API-KEY-ID': apiKey,
            'APCA-API-SECRET-KEY': apiSecret,
          },
        }),
      );
      return response.data
        .filter((a) => a.tradable && a.symbol && a.name)
        .map((a) => ({
          symbol: a.symbol,
          name: a.name,
          exchange: a.exchange,
          tradable: a.tradable,
        }));
    } catch (err) {
      this.logger.error(`Alpaca assets fetch failed, falling back to dev list: ${String(err)}`);
      return MOCK_ASSETS;
    }
  }
}

interface AlpacaAsset {
  symbol: string;
  name: string;
  exchange: string;
  tradable: boolean;
}
