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
  changePercentage?: number;
}

interface FmpNewsItem {
  title?: string;
  url?: string;
  publishedDate?: string;
  site?: string;
  text?: string;
}

interface FmpProfile {
  symbol?: string;
  companyName?: string;
  price?: number;
  change?: number;
  changePercentage?: number;
  marketCap?: number;
  sector?: string;
  volume?: number;
  lastDividend?: number;
}

interface FmpQuote {
  symbol?: string;
  price?: number;
  change?: number;
  changesPercentage?: number;
  changePercentage?: number;
  volume?: number;
}

interface ScreenerParams {
  marketCapMin?: number;
  marketCapMax?: number;
  volumeMin?: number;
  dividendYieldMin?: number;
  sector?: string;
  changeMin?: number;
  limit?: number;
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
  ScreenerResult,
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

// Curated S&P 500 universe for the stock screener (covers all major sectors)
const SCREENER_SYMBOLS = [
  // Technology
  'AAPL',
  'MSFT',
  'NVDA',
  'GOOGL',
  'META',
  'AMZN',
  'TSLA',
  'AMD',
  'INTC',
  'CRM',
  'ORCL',
  'ADBE',
  // Financials
  'JPM',
  'BAC',
  'WFC',
  'GS',
  'MS',
  'BLK',
  'V',
  'MA',
  'AXP',
  'C',
  'SCHW',
  // Healthcare
  'JNJ',
  'UNH',
  'PFE',
  'ABBV',
  'MRK',
  'LLY',
  'TMO',
  'ABT',
  'CVS',
  'MDT',
  // Energy
  'XOM',
  'CVX',
  'COP',
  'SLB',
  'EOG',
  'MPC',
  'PSX',
  'OXY',
  // Consumer Discretionary
  'HD',
  'MCD',
  'NKE',
  'SBUX',
  'LOW',
  'TGT',
  'COST',
  'NFLX',
  'BKNG',
  // Consumer Staples
  'PG',
  'KO',
  'PEP',
  'WMT',
  'PM',
  'MO',
  // Industrials
  'BA',
  'HON',
  'CAT',
  'LMT',
  'RTX',
  'UPS',
  'FDX',
  'DE',
  'MMM',
  'GE',
  // Communication Services
  'T',
  'VZ',
  'DIS',
  'CMCSA',
  // Utilities
  'NEE',
  'DUK',
  'SO',
  // Real Estate
  'AMT',
  'PLD',
  'EQIX',
  // Materials
  'LIN',
  'APD',
  'FCX',
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
    if (!keys.length) return this.getMoversFromFmp(top);

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

  private async loadMarketAssets(market: AssetMarket): Promise<AssetEntry[]> {
    const CACHE_KEY = `papi:assets:${market}`;
    const CACHE_TTL = 86400;
    const cached = await this.redis.get(CACHE_KEY);
    if (cached) return JSON.parse(cached) as AssetEntry[];
    let all: AssetEntry[];
    if (market === 'uk') {
      all = MOCK_UK_ASSETS;
    } else {
      all = await this.fetchAssetsFromMassive(market === 'etf' ? 'ETF' : 'CS');
    }
    await this.redis.set(CACHE_KEY, JSON.stringify(all), CACHE_TTL);
    return all;
  }

  async getAssets(
    search: string,
    page: number,
    limit: number,
    market: AssetMarket | 'all' = 'us',
  ): Promise<AssetsPage> {
    let all: AssetEntry[];
    if (market === 'all') {
      const [us, etf, uk] = await Promise.all([
        this.loadMarketAssets('us'),
        this.loadMarketAssets('etf'),
        this.loadMarketAssets('uk'),
      ]);
      const seen = new Set<string>();
      all = [...us, ...etf, ...uk].filter((a) => {
        if (seen.has(a.symbol)) return false;
        seen.add(a.symbol);
        return true;
      });
    } else {
      all = await this.loadMarketAssets(market);
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
    const polygonApiKey = this.config.get<string>('massiveApiKey') ?? '';

    const FMP_STABLE = 'https://financialmodelingprep.com/stable';
    const INDEX_SYMBOLS = ['^GSPC', '^IXIC', '^FTSE', '^GDAXI'];
    const INDEX_NAME_MAP: Record<string, string> = {
      '^GSPC': 'S&P 500',
      '^IXIC': 'Nasdaq',
      '^FTSE': 'FTSE 100',
      '^GDAXI': 'DAX',
    };
    const SECTOR_ETFS: Record<string, string> = {
      XLK: 'Technology',
      XLF: 'Financials',
      XLE: 'Energy',
      XLV: 'Health Care',
      XLY: 'Consumer Discretionary',
      XLP: 'Consumer Staples',
      XLI: 'Industrials',
      XLB: 'Materials',
      XLU: 'Utilities',
      XLRE: 'Real Estate',
      XLC: 'Communication Services',
    };

    const etfSymbols = Object.keys(SECTOR_ETFS);

    const [indexResults, newsResult, sectorResults] = await Promise.all([
      apiKey
        ? Promise.allSettled(
            INDEX_SYMBOLS.map((sym) =>
              firstValueFrom(
                this.httpService.get<FmpIndexQuote[]>(`${FMP_STABLE}/quote`, {
                  params: { symbol: sym, apikey: apiKey },
                  timeout: 5000,
                }),
              ),
            ),
          )
        : Promise.resolve([] as PromiseSettledResult<{ data: FmpIndexQuote[] }>[]),
      apiKey
        ? firstValueFrom(
            this.httpService.get<FmpNewsItem[]>(`${FMP_STABLE}/news/stock`, {
              params: { limit: 8, apikey: apiKey },
              timeout: 5000,
            }),
          ).catch(() => ({ data: [] as FmpNewsItem[] }))
        : Promise.resolve({ data: [] as FmpNewsItem[] }),
      polygonApiKey
        ? Promise.allSettled(
            etfSymbols.map((sym) =>
              firstValueFrom(
                this.httpService.get<{ ticker?: { todaysChangePerc?: number } }>(
                  `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${sym}`,
                  { params: { apiKey: polygonApiKey }, timeout: 5000 },
                ),
              ),
            ),
          )
        : Promise.resolve(
            [] as PromiseSettledResult<{ data: { ticker?: { todaysChangePerc?: number } } }>[],
          ),
    ]);

    const indices: IndexQuote[] = indexResults.flatMap((r) => {
      if (r.status !== 'fulfilled') return [];
      return (r.value.data ?? []).map((q) => ({
        symbol: q.symbol ?? '',
        name: INDEX_NAME_MAP[q.symbol ?? ''] ?? q.name ?? q.symbol ?? '',
        price: q.price ?? 0,
        change: q.change ?? 0,
        changesPercentage: q.changePercentage ?? q.changesPercentage ?? 0,
      }));
    });

    const sectors: SectorPerformance[] = sectorResults.flatMap((r, i) => {
      if (r.status !== 'fulfilled') return [];
      const changePerc = r.value.data?.ticker?.todaysChangePerc;
      if (changePerc === undefined || changePerc === null) return [];
      const sectorName = etfSymbols[i] !== undefined ? (SECTOR_ETFS[etfSymbols[i]] ?? '') : '';
      return [{ sector: sectorName, changesPercentage: changePerc }];
    });

    const news: MarketNewsItem[] = (newsResult.data ?? []).map((n) => ({
      title: n.title ?? '',
      url: n.url ?? '',
      publishedAt: n.publishedDate ?? '',
      source: n.site ?? '',
      summary: (n.text ?? '').slice(0, 200),
    }));

    const overview: MarketOverview = { indices, sectors, news };
    await this.redis.set(CACHE_KEY, JSON.stringify(overview), 300);
    return overview;
  }

  async getScreener(params: ScreenerParams): Promise<ScreenerResult[]> {
    const {
      marketCapMin,
      marketCapMax,
      volumeMin,
      dividendYieldMin,
      sector,
      changeMin,
      limit = 25,
    } = params;

    const all = await this.getScreenerProfiles();

    let results = all;
    if (marketCapMin !== undefined) results = results.filter((r) => r.marketCap >= marketCapMin);
    if (marketCapMax !== undefined) results = results.filter((r) => r.marketCap <= marketCapMax);
    if (volumeMin !== undefined) results = results.filter((r) => r.volume >= volumeMin);
    if (dividendYieldMin !== undefined)
      results = results.filter((r) => r.dividendYield >= dividendYieldMin);
    if (sector) results = results.filter((r) => r.sector.toLowerCase() === sector.toLowerCase());
    if (changeMin !== undefined) results = results.filter((r) => r.changesPercentage >= changeMin);

    results.sort((a, b) => b.marketCap - a.marketCap);
    return results.slice(0, limit);
  }

  private async getScreenerProfiles(): Promise<ScreenerResult[]> {
    const CACHE_KEY = 'papi:screener:profiles';
    const CACHE_TTL = 3600; // 1h — sector/fundamentals change slowly

    const cached = await this.redis.get(CACHE_KEY);
    if (cached) return JSON.parse(cached) as ScreenerResult[];

    const apiKey = this.config.get<string>('fmpApiKey') ?? '';
    if (!apiKey) {
      this.logger.warn('FMP_API_KEY not set — returning empty screener');
      return [];
    }

    const FMP_STABLE = 'https://financialmodelingprep.com/stable';

    const fetched = await Promise.allSettled(
      SCREENER_SYMBOLS.map((sym) =>
        firstValueFrom(
          this.httpService.get<FmpProfile[]>(
            `${FMP_STABLE}/profile?symbol=${sym}&apikey=${apiKey}`,
            {
              timeout: 5000,
            },
          ),
        ),
      ),
    );

    const profiles: ScreenerResult[] = fetched.flatMap((r) => {
      if (r.status !== 'fulfilled') return [];
      const p = r.value.data?.[0];
      if (!p?.symbol) return [];
      const price = p.price ?? 0;
      const dividendYield = price > 0 ? ((p.lastDividend ?? 0) / price) * 100 : 0;
      return [
        {
          symbol: p.symbol,
          name: p.companyName ?? '',
          price,
          change: p.change ?? 0,
          changesPercentage: p.changePercentage ?? 0,
          marketCap: p.marketCap ?? 0,
          sector: p.sector ?? '',
          volume: p.volume ?? 0,
          dividendYield,
        },
      ];
    });

    if (profiles.length > 0) {
      await this.redis.set(CACHE_KEY, JSON.stringify(profiles), CACHE_TTL);
    }
    return profiles;
  }

  private async getMoversFromFmp(top: number): Promise<MarketMovers> {
    const apiKey = this.config.get<string>('fmpApiKey') ?? '';
    if (!apiKey) {
      this.logger.warn('FMP_API_KEY not set — cannot build FMP movers fallback');
      return { gainers: [], losers: [] };
    }
    try {
      const results = await Promise.allSettled(
        DEFAULT_SYMBOLS.map((sym) =>
          firstValueFrom(
            this.httpService.get<FmpQuote[]>('https://financialmodelingprep.com/stable/quote', {
              params: { symbol: sym, apikey: apiKey },
              timeout: 5000,
            }),
          ),
        ),
      );
      const entries: MoverEntry[] = results
        .flatMap((r) => (r.status === 'fulfilled' ? (r.value.data ?? []) : []))
        .filter(
          (q): q is FmpQuote & { symbol: string; price: number } =>
            typeof q.symbol === 'string' && typeof q.price === 'number',
        )
        .map((q) => ({
          symbol: q.symbol,
          price: q.price,
          change: q.change ?? 0,
          changePercent: q.changePercentage ?? q.changesPercentage ?? 0,
          volume: q.volume ?? 0,
        }));

      entries.sort((a, b) => b.changePercent - a.changePercent);
      const movers: MarketMovers = {
        gainers: entries.slice(0, top),
        losers: entries.slice(-top).reverse(),
      };
      await this.redis.set('papi:movers', JSON.stringify(movers), 60);
      return movers;
    } catch (err) {
      this.logger.error(`FMP movers fallback failed: ${String(err)}`);
      return { gainers: [], losers: [] };
    }
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
