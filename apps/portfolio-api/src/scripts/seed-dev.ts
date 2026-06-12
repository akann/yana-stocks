/**
 * Seed Redis with realistic price, sentiment, and prediction data for local development.
 * Run: pnpm seed
 *
 * Populates:
 *   papi:price:<SYMBOL>      — drives /market/movers and /stocks/:symbol price
 *   papi:sentiment:<SYMBOL>  — drives /stocks/:symbol and /signals/:symbol sentiment
 *   papi:prediction:<SYMBOL> — drives /stocks/:symbol and /signals/:symbol prediction
 */
import 'dotenv/config';
import Redis from 'ioredis';
import type { PredictionSignal, SentimentSignal } from '@yana-stocks/shared-types';
import type { PriceCacheEntry } from '../stocks/price-cache.types';

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const TTL = 86_400; // 24 hours — survives overnight dev sessions

interface StockSeed {
  symbol: string;
  price: number;
  changePercent: number;
  volume: number;
  sentiment: { score: number; label: 'positive' | 'negative' | 'neutral'; headline: string };
  // 1d predicted price — 1h/4h/1w are derived proportionally
  prediction: { predictedPrice: number; confidence: number };
}

const STOCKS: StockSeed[] = [
  {
    symbol: 'NVDA',
    price: 134.25, changePercent: 4.82, volume: 41_200_000,
    sentiment: { score: 0.91, label: 'positive', headline: 'Nvidia beats estimates as AI chip demand surges in Q2' },
    prediction: { predictedPrice: 141.8, confidence: 0.84 },
  },
  {
    symbol: 'TSLA',
    price: 248.5, changePercent: 3.17, volume: 98_700_000,
    sentiment: { score: 0.76, label: 'positive', headline: 'Tesla deliveries top expectations, shares rally' },
    prediction: { predictedPrice: 258.9, confidence: 0.71 },
  },
  {
    symbol: 'META',
    price: 592.3, changePercent: 2.44, volume: 18_300_000,
    sentiment: { score: 0.68, label: 'positive', headline: 'Meta ad revenue grows 22% YoY on AI-targeted campaigns' },
    prediction: { predictedPrice: 608.5, confidence: 0.78 },
  },
  {
    symbol: 'AMZN',
    price: 214.6, changePercent: 1.89, volume: 35_600_000,
    sentiment: { score: 0.61, label: 'positive', headline: 'AWS growth accelerates as enterprise cloud spend rebounds' },
    prediction: { predictedPrice: 220.1, confidence: 0.75 },
  },
  {
    symbol: 'GOOGL',
    price: 178.9, changePercent: 0.73, volume: 22_100_000,
    sentiment: { score: 0.52, label: 'positive', headline: 'Google Search gains market share after AI Overviews rollout' },
    prediction: { predictedPrice: 181.4, confidence: 0.69 },
  },
  {
    symbol: 'MSFT',
    price: 445.2, changePercent: 0.41, volume: 19_800_000,
    sentiment: { score: 0.48, label: 'neutral', headline: 'Microsoft Copilot adoption steady; Azure beats by thin margin' },
    prediction: { predictedPrice: 447.9, confidence: 0.72 },
  },
  {
    symbol: 'JPM',
    price: 231.4, changePercent: -0.38, volume: 11_200_000,
    sentiment: { score: 0.44, label: 'neutral', headline: 'JPMorgan profit solid but net interest income guidance trimmed' },
    prediction: { predictedPrice: 229.8, confidence: 0.66 },
  },
  {
    symbol: 'V',
    price: 298.75, changePercent: -1.12, volume: 7_400_000,
    sentiment: { score: 0.35, label: 'neutral', headline: 'Visa cross-border volumes slow as consumer spending cools' },
    prediction: { predictedPrice: 294.2, confidence: 0.63 },
  },
  {
    symbol: 'AAPL',
    price: 213.18, changePercent: -2.65, volume: 54_300_000,
    sentiment: { score: 0.22, label: 'negative', headline: 'Apple iPhone sales miss in China amid Huawei competition' },
    prediction: { predictedPrice: 206.5, confidence: 0.68 },
  },
  {
    symbol: 'JNJ',
    price: 152.3, changePercent: -3.91, volume: 9_100_000,
    sentiment: { score: 0.12, label: 'negative', headline: 'J&J talc liability ruling raises fresh settlement concerns' },
    prediction: { predictedPrice: 146.8, confidence: 0.61 },
  },
];

async function seed(): Promise<void> {
  const redis = new Redis(REDIS_URL);
  const now = new Date();
  const pipeline = redis.pipeline();

  for (const stock of STOCKS) {
    const { symbol, price, changePercent, volume, sentiment, prediction } = stock;

    // Price
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

    // Sentiment
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

    // Multi-horizon predictions for /predict/:symbol (papi:predictions plural)
    // Scale the 1d delta proportionally: 1h=25%, 4h=55%, 1d=100%, 1w=300%
    const delta1d = prediction.predictedPrice - price;
    const horizons: Array<{ horizon: PredictionSignal['horizon']; scale: number; confidence: number }> = [
      { horizon: '1h',  scale: 0.25, confidence: Math.min(prediction.confidence + 0.08, 0.99) },
      { horizon: '4h',  scale: 0.55, confidence: Math.min(prediction.confidence + 0.04, 0.99) },
      { horizon: '1d',  scale: 1.00, confidence: prediction.confidence },
      { horizon: '1w',  scale: 3.00, confidence: Math.max(prediction.confidence - 0.12, 0.30) },
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
  }

  // Bust movers cache so it recomputes on next request
  pipeline.del('papi:movers');

  await pipeline.exec();
  await redis.quit();

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
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
