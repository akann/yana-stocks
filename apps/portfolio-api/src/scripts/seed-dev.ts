/**
 * Seed Redis with price/sentiment/prediction/history data and MongoDB with news + OHLCV bars.
 * Also seeds a dev user into PostgreSQL so login works without manual registration.
 * Run: pnpm seed
 *
 * Redis keys:
 *   papi:price:<SYMBOL>                    — drives /market/movers and /stocks/:symbol price
 *   papi:sentiment:<SYMBOL>                — drives /stocks/:symbol and /signals/:symbol sentiment
 *   papi:prediction:<SYMBOL>               — drives /stocks/:symbol and /signals/:symbol prediction
 *   papi:history:<SYMBOL>:<LIMIT>:<INTERVAL> — drives /stocks/:symbol/history (chart data)
 *   papi:assets:all                        — drives /market/assets (stock browser)
 *
 * MongoDB:
 *   yana_stocks.articles    — drives /news/:symbol
 *   yana_stocks.price_bars  — drives price-processor /prices/:symbol/history
 *
 * PostgreSQL (auth-service schema):
 *   users + user_credentials — dev@example.com / dF1o3WlFqCxctJ5U12 (pre-verified)
 */
import 'dotenv/config';
import Redis from 'ioredis';
import { MongoClient } from 'mongodb';
import { Client as PgClient } from 'pg';
import bcrypt from 'bcryptjs';
import type { PredictionSignal, SentimentSignal } from '@yana-stocks/shared-types';
import { MOCK_ASSETS } from '../stocks/mock-assets';
import type { PriceCacheEntry } from '../stocks/price-cache.types';

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const MONGODB_URI =
  process.env['MONGODB_URI'] ??
  'mongodb://admin:password@localhost:27017/yana_stocks?authSource=admin';
const DATABASE_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://postgres:password@localhost:5432/yana_stocks?sslmode=disable';
const TTL = 86_400; // 24 hours — survives overnight dev sessions

const DEV_USER_EMAIL = 'dev@example.com';
const DEV_USER_PASSWORD = 'dF1o3WlFqCxctJ5U12';

const BARS_PER_DAY = 390; // 6.5 trading hours × 60 min
const TRADING_DAYS = 252; // ~1 year of daily bars

interface OHLCVBar {
  symbol: string;
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  interval: '1m' | '1d';
}

/** Generate ~390 1-minute bars as a random walk ending at stock.price */
function generateMinuteBars(stock: StockSeed): OHLCVBar[] {
  const endPrice = stock.price;
  const startPrice = endPrice / (1 + stock.changePercent / 100);
  const bars: OHLCVBar[] = [];

  // Anchor end to current minute
  const endTime = new Date();
  endTime.setSeconds(0, 0);

  let prev = startPrice;
  for (let i = 0; i < BARS_PER_DAY; i++) {
    const timestamp = new Date(endTime.getTime() - (BARS_PER_DAY - 1 - i) * 60_000);
    // Linear drift toward endPrice + small Gaussian noise
    const drift = (endPrice - prev) / (BARS_PER_DAY - i);
    const noise = (Math.random() - 0.5) * stock.price * 0.0018;
    const close = Math.max(0.01, parseFloat((prev + drift + noise).toFixed(2)));
    const open = parseFloat(prev.toFixed(2));
    const spread = Math.abs(close - open) + stock.price * 0.0005;
    const high = parseFloat((Math.max(open, close) + Math.random() * spread).toFixed(2));
    const low = parseFloat((Math.min(open, close) - Math.random() * spread).toFixed(2));
    const volume = Math.floor((stock.volume / BARS_PER_DAY) * (0.4 + Math.random() * 1.2));
    bars.push({ symbol: stock.symbol, timestamp, open, high, low, close, volume, interval: '1m' });
    prev = close;
  }
  return bars;
}

/**
 * Generate ~252 daily bars (1 year) ending at stock.price.
 * Timestamps are spaced ~1.4 calendar days apart to approximate trading days
 * without needing exact weekend/holiday logic.
 */
function generateDailyBars(stock: StockSeed): OHLCVBar[] {
  const endPrice = stock.price;
  // Simulate a realistic year-ago start: positive stocks up ~20%, negative ones down ~10%
  const annualReturn = stock.changePercent >= 0 ? 0.18 : -0.08;
  const startPrice = endPrice / (1 + annualReturn);

  const endTime = new Date();
  endTime.setHours(16, 0, 0, 0); // market close
  // ~1.4 calendar days per trading day (accounts for weekends)
  const MS_PER_TRADING_DAY = 1.4 * 24 * 60 * 60 * 1000;

  const bars: OHLCVBar[] = [];
  let prev = startPrice;

  for (let i = 0; i < TRADING_DAYS; i++) {
    const timestamp = new Date(endTime.getTime() - (TRADING_DAYS - 1 - i) * MS_PER_TRADING_DAY);
    const drift = (endPrice - prev) / (TRADING_DAYS - i);
    const noise = (Math.random() - 0.5) * stock.price * 0.012;
    const close = Math.max(0.01, parseFloat((prev + drift + noise).toFixed(2)));
    const open = parseFloat(prev.toFixed(2));
    const spread = Math.abs(close - open) + stock.price * 0.004;
    const high = parseFloat((Math.max(open, close) + Math.random() * spread).toFixed(2));
    const low = parseFloat((Math.min(open, close) - Math.random() * spread).toFixed(2));
    const volume = Math.floor(stock.volume * (0.6 + Math.random() * 0.8));
    bars.push({ symbol: stock.symbol, timestamp, open, high, low, close, volume, interval: '1d' });
    prev = close;
  }
  return bars;
}

interface StockSeed {
  symbol: string;
  price: number;
  changePercent: number;
  volume: number;
  sentiment: { score: number; label: 'positive' | 'negative' | 'neutral'; headline: string };
  // 1d predicted price — 1h/4h/1w are derived proportionally
  prediction: { predictedPrice: number; confidence: number };
}

interface NewsArticleSeed {
  headline: string;
  source: string;
  url: string;
  sentiment_label: 'positive' | 'neutral' | 'negative';
  sentiment_score: number;
  hoursAgo: number;
}

const NEWS: Record<string, NewsArticleSeed[]> = {
  NVDA: [
    {
      headline: 'Nvidia beats estimates as AI chip demand surges in Q2',
      source: 'Reuters',
      url: 'https://reuters.com/nvda-q2',
      sentiment_label: 'positive',
      sentiment_score: 0.91,
      hoursAgo: 1,
    },
    {
      headline: 'Blackwell GPU shipments ahead of schedule, says CEO Jensen Huang',
      source: 'Bloomberg',
      url: 'https://bloomberg.com/nvda-blackwell',
      sentiment_label: 'positive',
      sentiment_score: 0.85,
      hoursAgo: 6,
    },
    {
      headline: 'Data center revenue doubles year-over-year for Nvidia',
      source: 'CNBC',
      url: 'https://cnbc.com/nvda-datacenter',
      sentiment_label: 'positive',
      sentiment_score: 0.82,
      hoursAgo: 12,
    },
  ],
  TSLA: [
    {
      headline: 'Tesla deliveries top expectations, shares rally',
      source: 'WSJ',
      url: 'https://wsj.com/tsla-deliveries',
      sentiment_label: 'positive',
      sentiment_score: 0.76,
      hoursAgo: 2,
    },
    {
      headline: 'Full self-driving software update wins positive reviews',
      source: 'TechCrunch',
      url: 'https://techcrunch.com/tsla-fsd',
      sentiment_label: 'positive',
      sentiment_score: 0.71,
      hoursAgo: 8,
    },
    {
      headline: 'Tesla faces renewed price war pressure in China',
      source: 'FT',
      url: 'https://ft.com/tsla-china',
      sentiment_label: 'negative',
      sentiment_score: 0.28,
      hoursAgo: 18,
    },
  ],
  META: [
    {
      headline: 'Meta ad revenue grows 22% YoY on AI-targeted campaigns',
      source: 'Reuters',
      url: 'https://reuters.com/meta-revenue',
      sentiment_label: 'positive',
      sentiment_score: 0.68,
      hoursAgo: 3,
    },
    {
      headline: 'Threads hits 200 million daily active users',
      source: 'Bloomberg',
      url: 'https://bloomberg.com/meta-threads',
      sentiment_label: 'positive',
      sentiment_score: 0.74,
      hoursAgo: 10,
    },
    {
      headline: 'EU regulators probe Meta data practices',
      source: 'Guardian',
      url: 'https://guardian.com/meta-eu',
      sentiment_label: 'negative',
      sentiment_score: 0.31,
      hoursAgo: 22,
    },
  ],
  AMZN: [
    {
      headline: 'AWS growth accelerates as enterprise cloud spend rebounds',
      source: 'CNBC',
      url: 'https://cnbc.com/amzn-aws',
      sentiment_label: 'positive',
      sentiment_score: 0.61,
      hoursAgo: 4,
    },
    {
      headline: 'Amazon Prime membership tops 200 million globally',
      source: 'Reuters',
      url: 'https://reuters.com/amzn-prime',
      sentiment_label: 'positive',
      sentiment_score: 0.65,
      hoursAgo: 14,
    },
    {
      headline: 'Logistics costs rise on last-mile delivery expansion',
      source: 'FT',
      url: 'https://ft.com/amzn-logistics',
      sentiment_label: 'neutral',
      sentiment_score: 0.42,
      hoursAgo: 26,
    },
  ],
  GOOGL: [
    {
      headline: 'Google Search gains market share after AI Overviews rollout',
      source: 'Bloomberg',
      url: 'https://bloomberg.com/googl-search',
      sentiment_label: 'positive',
      sentiment_score: 0.52,
      hoursAgo: 2,
    },
    {
      headline: 'Waymo expands robotaxi service to three new cities',
      source: 'TechCrunch',
      url: 'https://techcrunch.com/waymo-expansion',
      sentiment_label: 'positive',
      sentiment_score: 0.67,
      hoursAgo: 9,
    },
    {
      headline: 'DOJ antitrust case could force Google to sell Chrome',
      source: 'WSJ',
      url: 'https://wsj.com/googl-doj',
      sentiment_label: 'negative',
      sentiment_score: 0.18,
      hoursAgo: 30,
    },
  ],
  MSFT: [
    {
      headline: 'Microsoft Copilot adoption steady; Azure beats by thin margin',
      source: 'Reuters',
      url: 'https://reuters.com/msft-azure',
      sentiment_label: 'neutral',
      sentiment_score: 0.48,
      hoursAgo: 5,
    },
    {
      headline: 'GitHub Copilot reaches 1.8 million paid subscribers',
      source: 'CNBC',
      url: 'https://cnbc.com/msft-github',
      sentiment_label: 'positive',
      sentiment_score: 0.73,
      hoursAgo: 16,
    },
    {
      headline: 'Xbox gaming division revenue declines 8% year-over-year',
      source: 'Bloomberg',
      url: 'https://bloomberg.com/msft-xbox',
      sentiment_label: 'negative',
      sentiment_score: 0.26,
      hoursAgo: 24,
    },
  ],
  JPM: [
    {
      headline: 'JPMorgan profit solid but net interest income guidance trimmed',
      source: 'FT',
      url: 'https://ft.com/jpm-earnings',
      sentiment_label: 'neutral',
      sentiment_score: 0.44,
      hoursAgo: 3,
    },
    {
      headline: 'JPMorgan expands private credit business with $10B fund',
      source: 'Bloomberg',
      url: 'https://bloomberg.com/jpm-credit',
      sentiment_label: 'positive',
      sentiment_score: 0.6,
      hoursAgo: 11,
    },
    {
      headline: 'Fed stress test raises capital requirements for large banks',
      source: 'WSJ',
      url: 'https://wsj.com/fed-stress-test',
      sentiment_label: 'negative',
      sentiment_score: 0.33,
      hoursAgo: 20,
    },
  ],
  V: [
    {
      headline: 'Visa cross-border volumes slow as consumer spending cools',
      source: 'Reuters',
      url: 'https://reuters.com/visa-volumes',
      sentiment_label: 'neutral',
      sentiment_score: 0.35,
      hoursAgo: 4,
    },
    {
      headline: 'Visa launches tokenisation platform for e-commerce merchants',
      source: 'CNBC',
      url: 'https://cnbc.com/visa-token',
      sentiment_label: 'positive',
      sentiment_score: 0.58,
      hoursAgo: 15,
    },
    {
      headline: 'Regulators scrutinise Visa debit card interchange fees',
      source: 'FT',
      url: 'https://ft.com/visa-fees',
      sentiment_label: 'negative',
      sentiment_score: 0.29,
      hoursAgo: 28,
    },
  ],
  AAPL: [
    {
      headline: 'Apple iPhone sales miss in China amid Huawei competition',
      source: 'Bloomberg',
      url: 'https://bloomberg.com/aapl-china',
      sentiment_label: 'negative',
      sentiment_score: 0.22,
      hoursAgo: 2,
    },
    {
      headline: 'Apple Vision Pro 2 rumoured for early 2026 launch',
      source: 'MacRumors',
      url: 'https://macrumors.com/visionpro2',
      sentiment_label: 'neutral',
      sentiment_score: 0.5,
      hoursAgo: 10,
    },
    {
      headline: 'India manufacturing ramp reduces Apple supply chain risk',
      source: 'Reuters',
      url: 'https://reuters.com/aapl-india',
      sentiment_label: 'positive',
      sentiment_score: 0.64,
      hoursAgo: 18,
    },
  ],
  JNJ: [
    {
      headline: 'J&J talc liability ruling raises fresh settlement concerns',
      source: 'Reuters',
      url: 'https://reuters.com/jnj-talc',
      sentiment_label: 'negative',
      sentiment_score: 0.12,
      hoursAgo: 1,
    },
    {
      headline: 'Johnson & Johnson MedTech segment posts record quarterly revenue',
      source: 'CNBC',
      url: 'https://cnbc.com/jnj-medtech',
      sentiment_label: 'positive',
      sentiment_score: 0.69,
      hoursAgo: 12,
    },
    {
      headline: 'Darzalex biosimilar threat looms as patent cliff approaches',
      source: 'FT',
      url: 'https://ft.com/jnj-biosimilar',
      sentiment_label: 'negative',
      sentiment_score: 0.24,
      hoursAgo: 20,
    },
  ],

  // ── Top gainers ───────────────────────────────────────────────────────────
  SMCI: [
    {
      headline: 'Super Micro surges as AI server backlog hits record $4B',
      source: 'Bloomberg',
      url: 'https://bloomberg.com/smci-backlog',
      sentiment_label: 'positive',
      sentiment_score: 0.94,
      hoursAgo: 1,
    },
    {
      headline: 'SMCI reinstates full-year guidance; audit concerns resolved',
      source: 'Reuters',
      url: 'https://reuters.com/smci-guidance',
      sentiment_label: 'positive',
      sentiment_score: 0.88,
      hoursAgo: 5,
    },
    {
      headline: 'Nvidia partnership deepens as SMCI ships liquid-cooled GB200 racks',
      source: 'TechCrunch',
      url: 'https://techcrunch.com/smci-gb200',
      sentiment_label: 'positive',
      sentiment_score: 0.85,
      hoursAgo: 14,
    },
  ],
  PLTR: [
    {
      headline: 'Palantir wins $480M US Army AI contract extension',
      source: 'Reuters',
      url: 'https://reuters.com/pltr-army',
      sentiment_label: 'positive',
      sentiment_score: 0.89,
      hoursAgo: 2,
    },
    {
      headline: 'AIP commercial revenue doubles quarter-over-quarter',
      source: 'CNBC',
      url: 'https://cnbc.com/pltr-aip',
      sentiment_label: 'positive',
      sentiment_score: 0.83,
      hoursAgo: 8,
    },
    {
      headline: 'Palantir added to S&P 500; index-fund buying expected',
      source: 'Bloomberg',
      url: 'https://bloomberg.com/pltr-sp500',
      sentiment_label: 'positive',
      sentiment_score: 0.79,
      hoursAgo: 20,
    },
  ],
  CRWD: [
    {
      headline: 'CrowdStrike beats on ARR and raises full-year guidance',
      source: 'Reuters',
      url: 'https://reuters.com/crwd-earnings',
      sentiment_label: 'positive',
      sentiment_score: 0.86,
      hoursAgo: 3,
    },
    {
      headline: 'Federal CISA endorses CrowdStrike Falcon platform for critical infrastructure',
      source: 'WSJ',
      url: 'https://wsj.com/crwd-cisa',
      sentiment_label: 'positive',
      sentiment_score: 0.81,
      hoursAgo: 11,
    },
    {
      headline: 'CrowdStrike net retention rate climbs to 124% after recovery',
      source: 'Bloomberg',
      url: 'https://bloomberg.com/crwd-retention',
      sentiment_label: 'positive',
      sentiment_score: 0.77,
      hoursAgo: 24,
    },
  ],
  ARM: [
    {
      headline: 'Arm Holdings royalty revenue jumps 37% on AI chip wave',
      source: 'Bloomberg',
      url: 'https://bloomberg.com/arm-royalties',
      sentiment_label: 'positive',
      sentiment_score: 0.82,
      hoursAgo: 2,
    },
    {
      headline: 'Apple and Qualcomm renew long-term Arm architecture licences',
      source: 'Reuters',
      url: 'https://reuters.com/arm-licences',
      sentiment_label: 'positive',
      sentiment_score: 0.78,
      hoursAgo: 9,
    },
    {
      headline: 'Arm CSS for AI platform draws 15 new chip design customers',
      source: 'CNBC',
      url: 'https://cnbc.com/arm-css-ai',
      sentiment_label: 'positive',
      sentiment_score: 0.74,
      hoursAgo: 22,
    },
  ],
  COIN: [
    {
      headline: 'Bitcoin rally lifts Coinbase trading volume to six-month high',
      source: 'Bloomberg',
      url: 'https://bloomberg.com/coin-volume',
      sentiment_label: 'positive',
      sentiment_score: 0.78,
      hoursAgo: 1,
    },
    {
      headline: 'Coinbase Base L2 surpasses $8B TVL as DeFi activity rebounds',
      source: 'Reuters',
      url: 'https://reuters.com/coin-base-l2',
      sentiment_label: 'positive',
      sentiment_score: 0.73,
      hoursAgo: 7,
    },
    {
      headline: 'Spot Bitcoin ETF inflows hit record $1.4B in a single day',
      source: 'WSJ',
      url: 'https://wsj.com/btc-etf-inflows',
      sentiment_label: 'positive',
      sentiment_score: 0.7,
      hoursAgo: 18,
    },
  ],

  // ── Top losers ────────────────────────────────────────────────────────────
  INTC: [
    {
      headline: 'Intel loses x86 market share to AMD for the fifth straight quarter',
      source: 'Reuters',
      url: 'https://reuters.com/intc-share-loss',
      sentiment_label: 'negative',
      sentiment_score: 0.1,
      hoursAgo: 1,
    },
    {
      headline: 'Intel delays 18A node ramp citing yield issues',
      source: 'Bloomberg',
      url: 'https://bloomberg.com/intc-18a',
      sentiment_label: 'negative',
      sentiment_score: 0.08,
      hoursAgo: 6,
    },
    {
      headline: 'Intel Foundry losses widen to $2.8B in the quarter',
      source: 'WSJ',
      url: 'https://wsj.com/intc-foundry-loss',
      sentiment_label: 'negative',
      sentiment_score: 0.11,
      hoursAgo: 16,
    },
  ],
  MRNA: [
    {
      headline: 'Moderna mRNA cancer vaccine trial fails primary endpoint',
      source: 'Reuters',
      url: 'https://reuters.com/mrna-trial-failure',
      sentiment_label: 'negative',
      sentiment_score: 0.06,
      hoursAgo: 2,
    },
    {
      headline: 'Moderna cuts 2025 revenue forecast as COVID booster demand fades',
      source: 'Bloomberg',
      url: 'https://bloomberg.com/mrna-forecast-cut',
      sentiment_label: 'negative',
      sentiment_score: 0.09,
      hoursAgo: 8,
    },
    {
      headline: 'Moderna pipeline writedowns total $1.1B as R&D costs soar',
      source: 'FT',
      url: 'https://ft.com/mrna-writedowns',
      sentiment_label: 'negative',
      sentiment_score: 0.13,
      hoursAgo: 20,
    },
  ],
  WBD: [
    {
      headline: 'Warner Bros Discovery streaming losses exceed $600M in Q2',
      source: 'Bloomberg',
      url: 'https://bloomberg.com/wbd-streaming-loss',
      sentiment_label: 'negative',
      sentiment_score: 0.08,
      hoursAgo: 1,
    },
    {
      headline: 'WBD debt load at $40B triggers credit rating review',
      source: 'Reuters',
      url: 'https://reuters.com/wbd-debt',
      sentiment_label: 'negative',
      sentiment_score: 0.07,
      hoursAgo: 9,
    },
    {
      headline: 'Max subscriber growth stalls as Netflix competition intensifies',
      source: 'WSJ',
      url: 'https://wsj.com/wbd-max-subs',
      sentiment_label: 'negative',
      sentiment_score: 0.15,
      hoursAgo: 22,
    },
  ],
  PARA: [
    {
      headline: "Skydance merger uncertainty weighs on Paramount's share price",
      source: 'Bloomberg',
      url: 'https://bloomberg.com/para-skydance',
      sentiment_label: 'negative',
      sentiment_score: 0.14,
      hoursAgo: 3,
    },
    {
      headline: 'Paramount+ loses 3 million subscribers in the quarter',
      source: 'Reuters',
      url: 'https://reuters.com/para-subs',
      sentiment_label: 'negative',
      sentiment_score: 0.1,
      hoursAgo: 10,
    },
    {
      headline: 'Paramount TV studio revenue falls 18% on streaming shift',
      source: 'FT',
      url: 'https://ft.com/para-tv-revenue',
      sentiment_label: 'negative',
      sentiment_score: 0.16,
      hoursAgo: 24,
    },
  ],
  HOOD: [
    {
      headline: 'Robinhood crypto trading volumes drop 40% as retail interest cools',
      source: 'Bloomberg',
      url: 'https://bloomberg.com/hood-crypto-volume',
      sentiment_label: 'negative',
      sentiment_score: 0.17,
      hoursAgo: 2,
    },
    {
      headline: 'SEC charges Robinhood over options marketing to inexperienced traders',
      source: 'WSJ',
      url: 'https://wsj.com/hood-sec',
      sentiment_label: 'negative',
      sentiment_score: 0.09,
      hoursAgo: 7,
    },
    {
      headline: 'Robinhood MAU decline for third consecutive quarter',
      source: 'Reuters',
      url: 'https://reuters.com/hood-mau',
      sentiment_label: 'negative',
      sentiment_score: 0.13,
      hoursAgo: 19,
    },
  ],
};

const STOCKS: StockSeed[] = [
  {
    symbol: 'NVDA',
    price: 134.25,
    changePercent: 4.82,
    volume: 41_200_000,
    sentiment: {
      score: 0.91,
      label: 'positive',
      headline: 'Nvidia beats estimates as AI chip demand surges in Q2',
    },
    prediction: { predictedPrice: 141.8, confidence: 0.84 },
  },
  {
    symbol: 'TSLA',
    price: 248.5,
    changePercent: 3.17,
    volume: 98_700_000,
    sentiment: {
      score: 0.76,
      label: 'positive',
      headline: 'Tesla deliveries top expectations, shares rally',
    },
    prediction: { predictedPrice: 258.9, confidence: 0.71 },
  },
  {
    symbol: 'META',
    price: 592.3,
    changePercent: 2.44,
    volume: 18_300_000,
    sentiment: {
      score: 0.68,
      label: 'positive',
      headline: 'Meta ad revenue grows 22% YoY on AI-targeted campaigns',
    },
    prediction: { predictedPrice: 608.5, confidence: 0.78 },
  },
  {
    symbol: 'AMZN',
    price: 214.6,
    changePercent: 1.89,
    volume: 35_600_000,
    sentiment: {
      score: 0.61,
      label: 'positive',
      headline: 'AWS growth accelerates as enterprise cloud spend rebounds',
    },
    prediction: { predictedPrice: 220.1, confidence: 0.75 },
  },
  {
    symbol: 'GOOGL',
    price: 178.9,
    changePercent: 0.73,
    volume: 22_100_000,
    sentiment: {
      score: 0.52,
      label: 'positive',
      headline: 'Google Search gains market share after AI Overviews rollout',
    },
    prediction: { predictedPrice: 181.4, confidence: 0.69 },
  },
  {
    symbol: 'MSFT',
    price: 445.2,
    changePercent: 0.41,
    volume: 19_800_000,
    sentiment: {
      score: 0.48,
      label: 'neutral',
      headline: 'Microsoft Copilot adoption steady; Azure beats by thin margin',
    },
    prediction: { predictedPrice: 447.9, confidence: 0.72 },
  },
  {
    symbol: 'JPM',
    price: 231.4,
    changePercent: -0.38,
    volume: 11_200_000,
    sentiment: {
      score: 0.44,
      label: 'neutral',
      headline: 'JPMorgan profit solid but net interest income guidance trimmed',
    },
    prediction: { predictedPrice: 229.8, confidence: 0.66 },
  },
  {
    symbol: 'V',
    price: 298.75,
    changePercent: -1.12,
    volume: 7_400_000,
    sentiment: {
      score: 0.35,
      label: 'neutral',
      headline: 'Visa cross-border volumes slow as consumer spending cools',
    },
    prediction: { predictedPrice: 294.2, confidence: 0.63 },
  },
  {
    symbol: 'AAPL',
    price: 213.18,
    changePercent: -2.65,
    volume: 54_300_000,
    sentiment: {
      score: 0.22,
      label: 'negative',
      headline: 'Apple iPhone sales miss in China amid Huawei competition',
    },
    prediction: { predictedPrice: 206.5, confidence: 0.68 },
  },
  {
    symbol: 'JNJ',
    price: 152.3,
    changePercent: -3.91,
    volume: 9_100_000,
    sentiment: {
      score: 0.12,
      label: 'negative',
      headline: 'J&J talc liability ruling raises fresh settlement concerns',
    },
    prediction: { predictedPrice: 146.8, confidence: 0.61 },
  },

  // ── Top gainers ───────────────────────────────────────────────────────────
  {
    symbol: 'SMCI',
    price: 892.3,
    changePercent: 12.4,
    volume: 6_800_000,
    sentiment: {
      score: 0.94,
      label: 'positive',
      headline: 'Super Micro surges as AI server backlog hits record $4B',
    },
    prediction: { predictedPrice: 954.5, confidence: 0.81 },
  },
  {
    symbol: 'PLTR',
    price: 38.6,
    changePercent: 8.7,
    volume: 112_400_000,
    sentiment: {
      score: 0.89,
      label: 'positive',
      headline: 'Palantir wins $480M US Army AI contract extension',
    },
    prediction: { predictedPrice: 41.2, confidence: 0.77 },
  },
  {
    symbol: 'CRWD',
    price: 347.2,
    changePercent: 6.9,
    volume: 8_300_000,
    sentiment: {
      score: 0.86,
      label: 'positive',
      headline: 'CrowdStrike beats on ARR and raises full-year guidance',
    },
    prediction: { predictedPrice: 368.5, confidence: 0.79 },
  },
  {
    symbol: 'ARM',
    price: 158.4,
    changePercent: 5.8,
    volume: 14_700_000,
    sentiment: {
      score: 0.82,
      label: 'positive',
      headline: 'Arm Holdings royalty revenue jumps 37% on AI chip wave',
    },
    prediction: { predictedPrice: 166.1, confidence: 0.74 },
  },
  {
    symbol: 'COIN',
    price: 286.7,
    changePercent: 5.3,
    volume: 21_600_000,
    sentiment: {
      score: 0.78,
      label: 'positive',
      headline: 'Bitcoin rally lifts Coinbase trading volume to six-month high',
    },
    prediction: { predictedPrice: 299.8, confidence: 0.7 },
  },

  // ── Top losers ────────────────────────────────────────────────────────────
  {
    symbol: 'INTC',
    price: 20.15,
    changePercent: -8.2,
    volume: 89_300_000,
    sentiment: {
      score: 0.1,
      label: 'negative',
      headline: 'Intel loses x86 market share to AMD for the fifth straight quarter',
    },
    prediction: { predictedPrice: 18.6, confidence: 0.58 },
  },
  {
    symbol: 'MRNA',
    price: 68.3,
    changePercent: -10.1,
    volume: 24_500_000,
    sentiment: {
      score: 0.06,
      label: 'negative',
      headline: 'Moderna mRNA cancer vaccine trial fails primary endpoint',
    },
    prediction: { predictedPrice: 61.9, confidence: 0.55 },
  },
  {
    symbol: 'WBD',
    price: 7.8,
    changePercent: -7.3,
    volume: 38_100_000,
    sentiment: {
      score: 0.08,
      label: 'negative',
      headline: 'Warner Bros Discovery streaming losses exceed $600M in Q2',
    },
    prediction: { predictedPrice: 7.1, confidence: 0.52 },
  },
  {
    symbol: 'PARA',
    price: 10.45,
    changePercent: -6.4,
    volume: 16_900_000,
    sentiment: {
      score: 0.14,
      label: 'negative',
      headline: "Skydance merger uncertainty weighs on Paramount's share price",
    },
    prediction: { predictedPrice: 9.6, confidence: 0.54 },
  },
  {
    symbol: 'HOOD',
    price: 18.95,
    changePercent: -5.6,
    volume: 31_200_000,
    sentiment: {
      score: 0.17,
      label: 'negative',
      headline: 'Robinhood crypto trading volumes drop 40% as retail interest cools',
    },
    prediction: { predictedPrice: 17.4, confidence: 0.57 },
  },
];

async function seedAuthUser(): Promise<void> {
  const pg = new PgClient({ connectionString: DATABASE_URL });
  try {
    await pg.connect();

    // Create tables if auth-service hasn't run migrations yet (idempotent)
    await pg.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await pg.query(`
      CREATE TABLE IF NOT EXISTS users (
        id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        email              TEXT        NOT NULL UNIQUE,
        is_verified        BOOLEAN     NOT NULL DEFAULT false,
        verification_token TEXT,
        mfa_secret         TEXT,
        mfa_enabled        BOOLEAN     NOT NULL DEFAULT FALSE,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pg.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret TEXT`);
    await pg.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE`,
    );
    await pg.query(`
      CREATE TABLE IF NOT EXISTS user_credentials (
        user_id       UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        password_hash TEXT        NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const hash = await bcrypt.hash(DEV_USER_PASSWORD, 12);

    const { rows } = await pg.query<{ id: string }>(
      `INSERT INTO users (email, is_verified)
       VALUES ($1, true)
       ON CONFLICT (email) DO UPDATE SET is_verified = true, updated_at = NOW()
       RETURNING id`,
      [DEV_USER_EMAIL],
    );
    const userId = rows[0]!.id;

    await pg.query(
      `INSERT INTO user_credentials (user_id, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET password_hash = $2, updated_at = NOW()`,
      [userId, hash],
    );

    console.log(`Seeded dev user into PostgreSQL\n`);
    console.log(`  Email:    ${DEV_USER_EMAIL}`);
    console.log(`  Password: ${DEV_USER_PASSWORD}`);
    console.log(`  Verified: true\n`);
  } catch (err) {
    console.warn(`PostgreSQL seed skipped: ${String(err)}`);
  } finally {
    await pg.end();
  }
}

async function seed(): Promise<void> {
  const redis = new Redis(REDIS_URL);
  const now = new Date();
  const pipeline = redis.pipeline();

  const allMinuteBars: Record<string, OHLCVBar[]> = {};
  const allDailyBars: Record<string, OHLCVBar[]> = {};

  for (const stock of STOCKS) {
    const { symbol, price, changePercent, volume, sentiment, prediction } = stock;

    // ── Price ──────────────────────────────────────────────────────────────
    const change = parseFloat(((price * changePercent) / (100 + changePercent)).toFixed(2));
    const priceEntry: PriceCacheEntry = {
      price,
      prevPrice: parseFloat((price - change).toFixed(2)),
      change,
      changePercent,
      volume,
      timestamp: now.toISOString(),
    };
    pipeline.set(`papi:price:${symbol}`, JSON.stringify(priceEntry), 'EX', TTL);

    // ── Sentiment ──────────────────────────────────────────────────────────
    const sentimentEntry: SentimentSignal = {
      symbol,
      score: sentiment.score,
      label: sentiment.label,
      source: 'NewsAPI',
      headline: sentiment.headline,
      publishedAt: new Date(now.getTime() - Math.random() * 3_600_000),
      analyzedAt: now,
    };
    pipeline.set(`papi:sentiment:${symbol}`, JSON.stringify(sentimentEntry), 'EX', TTL);

    // ── Predictions ────────────────────────────────────────────────────────
    // Scale the 1d delta proportionally: 1h=25%, 4h=55%, 1d=100%, 1w=300%
    const delta1d = prediction.predictedPrice - price;
    const horizons: Array<{
      horizon: PredictionSignal['horizon'];
      scale: number;
      confidence: number;
    }> = [
      { horizon: '1h', scale: 0.25, confidence: Math.min(prediction.confidence + 0.08, 0.99) },
      { horizon: '4h', scale: 0.55, confidence: Math.min(prediction.confidence + 0.04, 0.99) },
      { horizon: '1d', scale: 1.0, confidence: prediction.confidence },
      { horizon: '1w', scale: 3.0, confidence: Math.max(prediction.confidence - 0.12, 0.3) },
    ];
    const predictions: PredictionSignal[] = horizons.map(({ horizon, scale, confidence }) => ({
      symbol,
      currentPrice: price,
      predictedPrice: parseFloat((price + delta1d * scale).toFixed(2)),
      confidence,
      horizon,
      model: 'prophet-v1',
      generatedAt: now,
    }));
    pipeline.set(`papi:predictions:${symbol}`, JSON.stringify(predictions), 'EX', TTL);
    // Single-prediction key still used by /signals/:symbol
    pipeline.set(`papi:prediction:${symbol}`, JSON.stringify(predictions[2]), 'EX', TTL);

    // ── History — 1m bars (1H and 1D chart ranges) ─────────────────────────
    const minuteBars = generateMinuteBars(stock);
    allMinuteBars[symbol] = minuteBars;
    const minuteDesc = [...minuteBars].reverse(); // newest first
    for (const limit of [60, 390]) {
      pipeline.set(
        `papi:history:${symbol}:${limit}:1m`,
        JSON.stringify(minuteDesc.slice(0, limit)),
        'EX',
        TTL,
      );
    }

    // ── History — 1d bars (1W / 1M / 3M / 6M / 1Y chart ranges) ──────────
    const dailyBars = generateDailyBars(stock);
    allDailyBars[symbol] = dailyBars;
    const dailyDesc = [...dailyBars].reverse(); // newest first
    for (const limit of [5, 21, 63, 126, 252]) {
      pipeline.set(
        `papi:history:${symbol}:${limit}:1d`,
        JSON.stringify(dailyDesc.slice(0, limit)),
        'EX',
        TTL,
      );
    }
  }

  // Bust movers cache so it recomputes on next request
  pipeline.del('papi:movers');

  // Seed full asset list so /market/assets works without Alpaca credentials
  pipeline.set('papi:assets:all', JSON.stringify(MOCK_ASSETS), 'EX', TTL);

  await pipeline.exec();
  await redis.quit();

  // ── MongoDB ──────────────────────────────────────────────────────────────
  const mongo = new MongoClient(MONGODB_URI);
  try {
    await mongo.connect();
    const db = mongo.db('yana_stocks');
    const barsCol = db.collection('price_bars');
    const symbols = STOCKS.map((s) => s.symbol);

    await barsCol.deleteMany({ symbol: { $in: symbols } });

    // 1m bars — strip the interval field; the query uses $in: ['1m', null] so
    // docs without an interval field are treated as 1m bars (backwards compat).
    const minuteBarDocs = Object.values(allMinuteBars)
      .flat()
      .map(({ interval: _interval, ...bar }) => bar);

    // 1d bars — keep the interval field; the query filters by interval: '1d'.
    const dailyBarDocs = Object.values(allDailyBars).flat();

    const allBarDocs = [...minuteBarDocs, ...dailyBarDocs];
    if (allBarDocs.length) {
      await barsCol.insertMany(allBarDocs);
      await barsCol.createIndex({ symbol: 1, timestamp: -1 });
      console.log(
        `Seeded ${minuteBarDocs.length} 1m bars + ${dailyBarDocs.length} 1d bars into MongoDB (price_bars)\n`,
      );
    }

    // NewsService reads from 'sentiment' database (hardcoded in news.service.ts)
    const col = mongo.db('sentiment').collection('articles');
    const articles = Object.entries(NEWS).flatMap(([symbol, items]) =>
      items.map((a) => ({
        symbol,
        headline: a.headline,
        source: a.source,
        url: a.url,
        published_at: new Date(now.getTime() - a.hoursAgo * 3_600_000).toISOString(),
        sentiment_label: a.sentiment_label,
        sentiment_score: a.sentiment_score,
        analyzed_at: new Date(now.getTime() - a.hoursAgo * 3_600_000 + 60_000),
      })),
    );
    await col.deleteMany({
      source: {
        $in: ['Reuters', 'Bloomberg', 'CNBC', 'WSJ', 'TechCrunch', 'FT', 'Guardian', 'MacRumors'],
      },
    });
    await col.insertMany(articles);
    console.log(`Seeded ${articles.length} news articles into MongoDB (sentiment.articles)\n`);
  } catch (err) {
    console.warn(`MongoDB seed skipped: ${String(err)}`);
  } finally {
    await mongo.close();
  }

  console.log(`Seeded ${STOCKS.length} symbols into Redis (${REDIS_URL})\n`);
  console.log('  Symbol  Price        Change   Sentiment  Predicted');
  console.log('  ──────  ──────────   ──────   ─────────  ─────────');
  for (const { symbol, price, changePercent, sentiment, prediction } of STOCKS) {
    const sign = changePercent >= 0 ? '+' : '';
    console.log(
      `  ${symbol.padEnd(6)}  $${price.toFixed(2).padStart(8)}   ${(sign + changePercent.toFixed(2) + '%').padStart(7)}` +
        `   ${sentiment.label.padEnd(9)}  $${prediction.predictedPrice.toFixed(2)}`,
    );
  }

  await seedAuthUser();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
