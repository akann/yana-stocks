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

interface FmpHistoricalSectorEntry {
  date: string;
  utilities?: number;
  basicMaterials?: number;
  communicationServices?: number;
  consumerCyclical?: number;
  consumerDefensive?: number;
  energy?: number;
  financialServices?: number;
  healthcare?: number;
  industrials?: number;
  realEstate?: number;
  technology?: number;
}

interface TwelveDataBar {
  datetime: string;
  close: string;
}

interface TwelveDataSeriesResponse {
  values?: TwelveDataBar[];
  status?: string;
}

import { RedisService } from '../redis/redis.service';
import { MOCK_ASSETS, MOCK_ETF_ASSETS, MOCK_GLOBAL_ASSETS, MOCK_UK_ASSETS } from './mock-assets';
import type {
  AggregateStockResponse,
  AssetEntry,
  AssetMarket,
  AssetsPage,
  FactorTile,
  IndexQuote,
  MarketMovers,
  MarketNewsItem,
  MarketOverview,
  MoverEntry,
  PriceCacheEntry,
  ScreenerResult,
  SectorPerformance,
  SectorRotationData,
  SectorRotationRow,
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
    } else if (market === 'global') {
      all = MOCK_GLOBAL_ASSETS;
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

  async getSectorRotation(index: 'sp500' | 'ftse100'): Promise<SectorRotationData> {
    const CACHE_KEY = `papi:sector:rotation:${index}`;
    const cached = await this.redis.get(CACHE_KEY);
    if (cached) return JSON.parse(cached) as SectorRotationData;

    if (index === 'ftse100') return this.getFtse100SectorRotation(CACHE_KEY);

    const apiKey = this.config.get<string>('fmpApiKey') ?? '';
    if (!apiKey) return { dates: [], rows: [] };

    const FMP_STABLE = 'https://financialmodelingprep.com/stable';
    const resp = await firstValueFrom(
      this.httpService.get<FmpHistoricalSectorEntry[]>(
        `${FMP_STABLE}/historical-sectors-performance`,
        { params: { limit: 12, apikey: apiKey }, timeout: 8000 },
      ),
    ).catch(() => ({ data: [] as FmpHistoricalSectorEntry[] }));

    // FMP returns newest-first; reverse to chronological order for the heatmap
    const entries = [...(resp.data ?? [])].reverse();
    const dates = entries.map((e) => e.date);

    const SECTOR_FIELDS: [keyof Omit<FmpHistoricalSectorEntry, 'date'>, string][] = [
      ['technology', 'Technology'],
      ['financialServices', 'Financials'],
      ['healthcare', 'Health Care'],
      ['consumerCyclical', 'Consumer Disc.'],
      ['industrials', 'Industrials'],
      ['communicationServices', 'Comm. Services'],
      ['consumerDefensive', 'Consumer Staples'],
      ['energy', 'Energy'],
      ['realEstate', 'Real Estate'],
      ['basicMaterials', 'Materials'],
      ['utilities', 'Utilities'],
    ];

    const rows: SectorRotationRow[] = SECTOR_FIELDS.map(([field, sector]) => ({
      sector,
      changes: entries.map((e) => Number(e[field] ?? 0)),
    }));

    if (entries.length > 0) {
      const result: SectorRotationData = { dates, rows };
      await this.redis.set(CACHE_KEY, JSON.stringify(result), 3600);
      return result;
    }

    // FMP historical data unavailable — fall back to today's Polygon sector ETF snapshots
    const polygonApiKey = this.config.get<string>('massiveApiKey') ?? '';
    if (!polygonApiKey) return { dates: [], rows: [] };

    const SECTOR_ETFS = [
      { etf: 'XLK', sector: 'Technology' },
      { etf: 'XLF', sector: 'Financials' },
      { etf: 'XLV', sector: 'Health Care' },
      { etf: 'XLY', sector: 'Consumer Disc.' },
      { etf: 'XLI', sector: 'Industrials' },
      { etf: 'XLC', sector: 'Comm. Services' },
      { etf: 'XLP', sector: 'Consumer Staples' },
      { etf: 'XLE', sector: 'Energy' },
      { etf: 'XLRE', sector: 'Real Estate' },
      { etf: 'XLB', sector: 'Materials' },
      { etf: 'XLU', sector: 'Utilities' },
    ];

    const snapshots = await Promise.allSettled(
      SECTOR_ETFS.map(({ etf }) =>
        firstValueFrom(
          this.httpService.get<{ ticker?: { todaysChangePerc?: number } }>(
            `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${etf}`,
            { params: { apiKey: polygonApiKey }, timeout: 5000 },
          ),
        ),
      ),
    );

    const today = new Date().toISOString().slice(0, 10);
    const fallbackRows: SectorRotationRow[] = SECTOR_ETFS.map(({ sector }, i) => {
      const r = snapshots[i];
      const change = r?.status === 'fulfilled' ? (r.value.data?.ticker?.todaysChangePerc ?? 0) : 0;
      return { sector, changes: [change] };
    });

    const fallback: SectorRotationData = { dates: [today], rows: fallbackRows };
    await this.redis.set(CACHE_KEY, JSON.stringify(fallback), 300);
    return fallback;
  }

  private async getFtse100SectorRotation(cacheKey: string): Promise<SectorRotationData> {
    const tdApiKey = this.config.get<string>('twelveDataApiKey') ?? '';
    if (!tdApiKey) return { dates: [], rows: [] };

    // Twelve Data symbols for LSE stocks (exchange=LSE param disambiguates from US markets).
    // BT Group trades as BT.A on LSE — the bare "BT" ticker resolves to a different instrument.
    const FTSE_SECTOR_BASKETS: { sector: string; tdSymbols: string[] }[] = [
      { sector: 'Technology', tdSymbols: ['SAGE', 'EXPN', 'HLMA'] },
      { sector: 'Financials', tdSymbols: ['HSBA', 'LLOY', 'BARC'] },
      { sector: 'Health Care', tdSymbols: ['AZN', 'GSK', 'HLN'] },
      { sector: 'Consumer Disc.', tdSymbols: ['JD', 'MKS', 'CPG'] },
      { sector: 'Industrials', tdSymbols: ['BA', 'RR', 'WEIR'] },
      { sector: 'Comm. Services', tdSymbols: ['BT.A', 'VOD'] },
      { sector: 'Consumer Staples', tdSymbols: ['DGE', 'TSCO', 'BATS'] },
      { sector: 'Energy', tdSymbols: ['BP', 'SHEL'] },
      { sector: 'Real Estate', tdSymbols: ['SGRO', 'BLND', 'LAND'] },
      { sector: 'Materials', tdSymbols: ['RIO', 'GLEN', 'AAL'] },
      { sector: 'Utilities', tdSymbols: ['NG', 'SSE', 'SVT'] },
    ];

    // Flatten to (sector, symbol) pairs — 31 total — and fetch all in parallel.
    // outputsize=13 gives 13 daily bars from which we derive 12 daily % changes.
    const NUM_DATES = 12;
    const allStocks = FTSE_SECTOR_BASKETS.flatMap(({ sector, tdSymbols }) =>
      tdSymbols.map((tdSymbol) => ({ sector, tdSymbol })),
    );

    const results = await Promise.allSettled(
      allStocks.map(({ tdSymbol }) =>
        firstValueFrom(
          this.httpService.get<TwelveDataSeriesResponse>('https://api.twelvedata.com/time_series', {
            params: {
              symbol: tdSymbol,
              exchange: 'LSE',
              interval: '1day',
              outputsize: NUM_DATES + 1,
              apikey: tdApiKey,
            },
            timeout: 10_000,
          }),
        ),
      ),
    );

    // Aggregate into: sector → date → [daily % changes across stocks in sector]
    const sectorDateMap = new Map<string, Map<string, number[]>>();

    for (const [i, result] of results.entries()) {
      if (result.status !== 'fulfilled') continue;
      const { sector } = allStocks[i]!;
      const values = result.value.data?.values ?? [];
      if (values.length < 2) continue;

      if (!sectorDateMap.has(sector)) sectorDateMap.set(sector, new Map());
      const dateMap = sectorDateMap.get(sector)!;

      // Twelve Data returns values newest-first; bar[j] vs bar[j+1] gives daily change
      for (let j = 0; j < values.length - 1; j++) {
        const close = parseFloat(values[j]!.close);
        const prevClose = parseFloat(values[j + 1]!.close);
        if (!prevClose) continue;
        const change = ((close - prevClose) / prevClose) * 100;
        const date = values[j]!.datetime.slice(0, 10);
        if (!dateMap.has(date)) dateMap.set(date, []);
        dateMap.get(date)!.push(change);
      }
    }

    // Collect all dates, sort chronologically, take the most recent NUM_DATES
    const allDates = new Set<string>();
    for (const dateMap of sectorDateMap.values()) {
      for (const date of dateMap.keys()) allDates.add(date);
    }
    const sortedDates = [...allDates].sort().slice(-NUM_DATES);
    if (sortedDates.length === 0) return { dates: [], rows: [] };

    const rows: SectorRotationRow[] = FTSE_SECTOR_BASKETS.map(({ sector }) => {
      const dateMap = sectorDateMap.get(sector) ?? new Map<string, number[]>();
      const changes = sortedDates.map((date) => {
        const dayChanges = dateMap.get(date) ?? [];
        return dayChanges.length > 0
          ? dayChanges.reduce((a, b) => a + b, 0) / dayChanges.length
          : 0;
      });
      return { sector, changes };
    });

    const result: SectorRotationData = { dates: sortedDates, rows };
    await this.redis.set(cacheKey, JSON.stringify(result), 3600);
    return result;
  }

  async getFactorPerformance(): Promise<FactorTile[]> {
    const CACHE_KEY = 'papi:factors';
    const cached = await this.redis.get(CACHE_KEY);
    if (cached) return JSON.parse(cached) as FactorTile[];

    const FACTOR_ETFS = [
      { factor: 'Momentum', etf: 'MTUM' },
      { factor: 'Value', etf: 'VTV' },
      { factor: 'Growth', etf: 'VUG' },
      { factor: 'Dividend', etf: 'VIG' },
      { factor: 'Low Volatility', etf: 'USMV' },
      { factor: 'Quality', etf: 'QUAL' },
    ];

    const histResults = await Promise.allSettled(
      FACTOR_ETFS.map(({ etf }) =>
        firstValueFrom(
          this.httpService.get<OHLCV[]>(
            `${this.priceProcessorUrl}/prices/${etf}/history?limit=22&interval=1d`,
            { timeout: 5000 },
          ),
        ),
      ),
    );

    const tiles: FactorTile[] = FACTOR_ETFS.map(({ factor, etf }, i) => {
      const r = histResults[i];
      if (!r || r.status !== 'fulfilled' || !r.value.data?.length) {
        return { factor, etf, price: 0, change1d: 0, change1w: 0, change1m: 0 };
      }
      const bars = r.value.data;
      const n = bars.length;
      const price = Number(bars[n - 1]!.close);
      const prev1d = n >= 2 ? Number(bars[n - 2]!.close) : price;
      const prev1w = n >= 6 ? Number(bars[n - 6]!.close) : price;
      const prev1m = n >= 22 ? Number(bars[n - 22]!.close) : Number(bars[0]!.close);
      const pct = (from: number) => (from ? ((price - from) / from) * 100 : 0);
      return {
        factor,
        etf,
        price,
        change1d: pct(prev1d),
        change1w: pct(prev1w),
        change1m: pct(prev1m),
      };
    });

    await this.redis.set(CACHE_KEY, JSON.stringify(tiles), 900);
    return tiles;
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
