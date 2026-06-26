import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import axios from 'axios';
import type { AxiosInstance } from 'axios';
import { Model } from 'mongoose';
import { RedisService } from '../redis/redis.service';
import type { QuoteEntry } from './prices.service';
import { PriceBar } from './schemas/price-bar.schema';

interface TwelveDataQuote {
  close?: string;
  previous_close?: string;
  volume?: string;
  status?: string;
  message?: string;
}

interface TwelveDataBar {
  datetime?: string;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  volume?: string;
}

interface TwelveDataTimeSeries {
  values?: TwelveDataBar[];
  status?: string;
  message?: string;
}

const QUOTE_CACHE_TTL = 900;
const HISTORY_FETCH_TTL = 900;

@Injectable()
export class TwelveDataService {
  private readonly logger = new Logger(TwelveDataService.name);
  private readonly http: AxiosInstance;
  private readonly apiKey: string;

  constructor(
    @InjectModel(PriceBar.name) private readonly priceBarsModel: Model<PriceBar>,
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.apiKey = config.get<string>('twelveData.apiKey') ?? '';
    this.http = axios.create({ baseURL: 'https://api.twelvedata.com', timeout: 8000 });
  }

  private tdSymbol(symbol: string): string {
    return symbol.endsWith('.L') ? symbol.slice(0, -2) : symbol;
  }

  async getQuote(symbol: string): Promise<QuoteEntry | null> {
    const cacheKey = `price:quote:${symbol}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as QuoteEntry;

    if (!this.apiKey) {
      this.logger.warn('TWELVE_DATA_API_KEY not set — cannot quote %s', symbol);
      return null;
    }

    try {
      const resp = await this.http.get<TwelveDataQuote>('/quote', {
        params: { symbol: this.tdSymbol(symbol), exchange: 'LSE', apikey: this.apiKey },
      });
      const d = resp.data;
      if (d.status === 'error' || !d.close) {
        this.logger.warn('Twelve Data quote error for %s: %s', symbol, d.message ?? 'no close');
        return null;
      }

      const close = parseFloat(d.close);
      const prevClose = parseFloat(d.previous_close ?? '0');
      const volume = parseFloat(d.volume ?? '0');
      const change = close - prevClose;
      const changePercent = prevClose ? (change / prevClose) * 100 : 0;

      const entry: QuoteEntry = {
        price: close,
        prevPrice: prevClose,
        change,
        changePercent,
        volume,
        timestamp: new Date().toISOString(),
      };

      await this.redis.setex(cacheKey, QUOTE_CACHE_TTL, JSON.stringify(entry));
      return entry;
    } catch (err) {
      this.logger.warn('Twelve Data quote failed for %s: %s', symbol, (err as Error).message);
      return null;
    }
  }

  async fetchAndStoreHistory(
    symbol: string,
    interval: string,
    limit: number,
    filter: Record<string, unknown>,
  ): Promise<PriceBar[]> {
    const noDataKey = `hist:no-data:${symbol}:${interval}`;
    if (await this.redis.get(noDataKey)) return [];

    if (!this.apiKey) {
      this.logger.warn('TWELVE_DATA_API_KEY not set — cannot fetch history for %s', symbol);
      return [];
    }

    const tdInterval = interval === '1d' ? '1day' : '1min';
    const outputsize = interval === '1d' ? 730 : Math.min(limit, 390);

    try {
      const resp = await this.http.get<TwelveDataTimeSeries>('/time_series', {
        params: {
          symbol: this.tdSymbol(symbol),
          exchange: 'LSE',
          interval: tdInterval,
          outputsize,
          apikey: this.apiKey,
        },
      });
      const d = resp.data;
      if (d.status === 'error' || !d.values?.length) {
        this.logger.warn('Twelve Data history error for %s: %s', symbol, d.message ?? 'no values');
        await this.redis.setex(noDataKey, 86400, '1');
        return [];
      }

      this.logger.log(
        'Fetched %d %s bars from Twelve Data for %s',
        d.values.length,
        interval,
        symbol,
      );

      const ops = d.values.map((bar) => {
        const ts = new Date(bar.datetime ?? 0);
        return {
          updateOne: {
            filter: { symbol, timestamp: ts, interval },
            update: {
              $setOnInsert: {
                symbol,
                timestamp: ts,
                open: parseFloat(bar.open ?? '0'),
                high: parseFloat(bar.high ?? '0'),
                low: parseFloat(bar.low ?? '0'),
                close: parseFloat(bar.close ?? '0'),
                volume: parseFloat(bar.volume ?? '0'),
                interval,
              },
            },
            upsert: true,
          },
        };
      });

      await this.priceBarsModel.bulkWrite(ops, { ordered: false });
      await this.redis.setex(`hist:fetched:${symbol}:${interval}`, HISTORY_FETCH_TTL, '1');

      return this.priceBarsModel
        .find(filter)
        .sort({ timestamp: -1 })
        .limit(limit)
        .lean<PriceBar[]>()
        .exec();
    } catch (err) {
      this.logger.warn(
        'Twelve Data history failed for %s (%s): %s',
        symbol,
        interval,
        (err as Error).message,
      );
      return [];
    }
  }
}
