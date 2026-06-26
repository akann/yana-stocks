import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OHLCV, PredictionSignal, SentimentSignal } from '@yana-stocks/shared-types';
import { firstValueFrom } from 'rxjs';

interface FmpIndexQuote {
  symbol?: string;
  name?: string;
  price?: number;
  change?: number;
  changesPercentage?: number;
}

interface FmpSectorPerformance {
  sector?: string;
  changesPercentage?: string | number;
}

interface FmpNewsItem {
  title?: string;
  url?: string;
  publishedDate?: string;
  site?: string;
  text?: string;
}

interface PolygonTickerResult {
  ticker?: string;
  name?: string;
  primary_exchange?: string;
}

interface PolygonTickersResponse {
  results?: PolygonTickerResult[];
}
import { RedisService } from '../redis/redis.service';
import { MOCK_ASSETS, MOCK_ETF_ASSETS, MOCK_UK_ASSETS } from './mock-assets';
import type {
  AggregateStockResponse,
  AssetEntry,
  AssetMarket,
  AssetsPage,
  IndexQuote,
  MarketMovers,
  MarketNewsItem,
  MarketOverview,
  MoverEntry,
  PriceCacheEntry,
  SectorPerformance,
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
          this.httpService.get<PriceCacheEntry>(
            `${this.priceProcessorUrl}/prices/${symbol}/quote`,
            {
              timeout: 3000,
            },
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
    } else if (market === 'uk') {
      all = MOCK_UK_ASSETS;
      await this.redis.set(CACHE_KEY, JSON.stringify(all), CACHE_TTL);
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

  async getOverview(): Promise<MarketOverview> {
    const CACHE_KEY = 'papi:overview';
    const cached = await this.redis.get(CACHE_KEY);
    if (cached) return JSON.parse(cached) as MarketOverview;

    const apiKey = this.config.get<string>('fmpApiKey') ?? '';
    if (!apiKey) {
      this.logger.warn('FMP_API_KEY not set — returning empty market overview');
      return { indices: [], sectors: [], news: [] };
    }

    const FMP_BASE = 'https://financialmodelingprep.com/api/v3';
    const INDEX_SYMBOLS = '%5EGSPC,%5EIXIC,%5EFTSE,%5EGDAXI';

    const [indicesResult, sectorsResult, newsResult] = await Promise.allSettled([
      firstValueFrom(
        this.httpService.get<FmpIndexQuote[]>(`${FMP_BASE}/quote/${INDEX_SYMBOLS}`, {
          params: { apikey: apiKey },
          timeout: 5000,
        }),
      ),
      firstValueFrom(
        this.httpService.get<FmpSectorPerformance[]>(`${FMP_BASE}/sector-performance`, {
          params: { apikey: apiKey },
          timeout: 5000,
        }),
      ),
      firstValueFrom(
        this.httpService.get<FmpNewsItem[]>(`${FMP_BASE}/stock_news`, {
          params: { tickers: 'SPY,QQQ,DIA', limit: 8, apikey: apiKey },
          timeout: 5000,
        }),
      ),
    ]);

    const INDEX_NAME_MAP: Record<string, string> = {
      '^GSPC': 'S&P 500',
      '^IXIC': 'Nasdaq',
      '^FTSE': 'FTSE 100',
      '^GDAXI': 'DAX',
    };

    const indices: IndexQuote[] =
      indicesResult.status === 'fulfilled'
        ? (indicesResult.value.data ?? []).map((q) => ({
            symbol: q.symbol ?? '',
            name: INDEX_NAME_MAP[q.symbol ?? ''] ?? q.name ?? q.symbol ?? '',
            price: q.price ?? 0,
            change: q.change ?? 0,
            changesPercentage: q.changesPercentage ?? 0,
          }))
        : [];

    const sectors: SectorPerformance[] =
      sectorsResult.status === 'fulfilled'
        ? (sectorsResult.value.data ?? []).map((s) => ({
            sector: s.sector ?? '',
            changesPercentage: parseFloat(String(s.changesPercentage ?? '0').replace('%', '')),
          }))
        : [];

    const news: MarketNewsItem[] =
      newsResult.status === 'fulfilled'
        ? (newsResult.value.data ?? []).map((n) => ({
            title: n.title ?? '',
            url: n.url ?? '',
            publishedAt: n.publishedDate ?? '',
            source: n.site ?? '',
            summary: (n.text ?? '').slice(0, 200),
          }))
        : [];

    const overview: MarketOverview = { indices, sectors, news };
    await this.redis.set(CACHE_KEY, JSON.stringify(overview), 300);
    return overview;
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
