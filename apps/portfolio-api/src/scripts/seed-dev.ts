/**
 * Seed Redis with price/sentiment/prediction data and MongoDB with news articles for local dev.
 * Run: pnpm seed
 *
 * Redis keys:
 *   papi:price:<SYMBOL>      — drives /market/movers and /stocks/:symbol price
 *   papi:sentiment:<SYMBOL>  — drives /stocks/:symbol and /signals/:symbol sentiment
 *   papi:prediction:<SYMBOL> — drives /stocks/:symbol and /signals/:symbol prediction
 *
 * MongoDB:
 *   yana_stocks.articles     — drives /news/:symbol
 */
import 'dotenv/config';
import Redis from 'ioredis';
import { MongoClient } from 'mongodb';
import type { PredictionSignal, SentimentSignal } from '@yana-stocks/shared-types';
import { MOCK_ASSETS } from '../stocks/mock-assets';
import type { PriceCacheEntry } from '../stocks/price-cache.types';

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const MONGODB_URI = process.env['MONGODB_URI'] ?? 'mongodb://admin:password@localhost:27017/yana_stocks?authSource=admin';
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
    { headline: 'Nvidia beats estimates as AI chip demand surges in Q2', source: 'Reuters', url: 'https://reuters.com/nvda-q2', sentiment_label: 'positive', sentiment_score: 0.91, hoursAgo: 1 },
    { headline: 'Blackwell GPU shipments ahead of schedule, says CEO Jensen Huang', source: 'Bloomberg', url: 'https://bloomberg.com/nvda-blackwell', sentiment_label: 'positive', sentiment_score: 0.85, hoursAgo: 6 },
    { headline: 'Data center revenue doubles year-over-year for Nvidia', source: 'CNBC', url: 'https://cnbc.com/nvda-datacenter', sentiment_label: 'positive', sentiment_score: 0.82, hoursAgo: 12 },
  ],
  TSLA: [
    { headline: 'Tesla deliveries top expectations, shares rally', source: 'WSJ', url: 'https://wsj.com/tsla-deliveries', sentiment_label: 'positive', sentiment_score: 0.76, hoursAgo: 2 },
    { headline: 'Full self-driving software update wins positive reviews', source: 'TechCrunch', url: 'https://techcrunch.com/tsla-fsd', sentiment_label: 'positive', sentiment_score: 0.71, hoursAgo: 8 },
    { headline: 'Tesla faces renewed price war pressure in China', source: 'FT', url: 'https://ft.com/tsla-china', sentiment_label: 'negative', sentiment_score: 0.28, hoursAgo: 18 },
  ],
  META: [
    { headline: 'Meta ad revenue grows 22% YoY on AI-targeted campaigns', source: 'Reuters', url: 'https://reuters.com/meta-revenue', sentiment_label: 'positive', sentiment_score: 0.68, hoursAgo: 3 },
    { headline: 'Threads hits 200 million daily active users', source: 'Bloomberg', url: 'https://bloomberg.com/meta-threads', sentiment_label: 'positive', sentiment_score: 0.74, hoursAgo: 10 },
    { headline: 'EU regulators probe Meta data practices', source: 'Guardian', url: 'https://guardian.com/meta-eu', sentiment_label: 'negative', sentiment_score: 0.31, hoursAgo: 22 },
  ],
  AMZN: [
    { headline: 'AWS growth accelerates as enterprise cloud spend rebounds', source: 'CNBC', url: 'https://cnbc.com/amzn-aws', sentiment_label: 'positive', sentiment_score: 0.61, hoursAgo: 4 },
    { headline: 'Amazon Prime membership tops 200 million globally', source: 'Reuters', url: 'https://reuters.com/amzn-prime', sentiment_label: 'positive', sentiment_score: 0.65, hoursAgo: 14 },
    { headline: 'Logistics costs rise on last-mile delivery expansion', source: 'FT', url: 'https://ft.com/amzn-logistics', sentiment_label: 'neutral', sentiment_score: 0.42, hoursAgo: 26 },
  ],
  GOOGL: [
    { headline: 'Google Search gains market share after AI Overviews rollout', source: 'Bloomberg', url: 'https://bloomberg.com/googl-search', sentiment_label: 'positive', sentiment_score: 0.52, hoursAgo: 2 },
    { headline: 'Waymo expands robotaxi service to three new cities', source: 'TechCrunch', url: 'https://techcrunch.com/waymo-expansion', sentiment_label: 'positive', sentiment_score: 0.67, hoursAgo: 9 },
    { headline: 'DOJ antitrust case could force Google to sell Chrome', source: 'WSJ', url: 'https://wsj.com/googl-doj', sentiment_label: 'negative', sentiment_score: 0.18, hoursAgo: 30 },
  ],
  MSFT: [
    { headline: 'Microsoft Copilot adoption steady; Azure beats by thin margin', source: 'Reuters', url: 'https://reuters.com/msft-azure', sentiment_label: 'neutral', sentiment_score: 0.48, hoursAgo: 5 },
    { headline: 'GitHub Copilot reaches 1.8 million paid subscribers', source: 'CNBC', url: 'https://cnbc.com/msft-github', sentiment_label: 'positive', sentiment_score: 0.73, hoursAgo: 16 },
    { headline: 'Xbox gaming division revenue declines 8% year-over-year', source: 'Bloomberg', url: 'https://bloomberg.com/msft-xbox', sentiment_label: 'negative', sentiment_score: 0.26, hoursAgo: 24 },
  ],
  JPM: [
    { headline: 'JPMorgan profit solid but net interest income guidance trimmed', source: 'FT', url: 'https://ft.com/jpm-earnings', sentiment_label: 'neutral', sentiment_score: 0.44, hoursAgo: 3 },
    { headline: 'JPMorgan expands private credit business with $10B fund', source: 'Bloomberg', url: 'https://bloomberg.com/jpm-credit', sentiment_label: 'positive', sentiment_score: 0.60, hoursAgo: 11 },
    { headline: 'Fed stress test raises capital requirements for large banks', source: 'WSJ', url: 'https://wsj.com/fed-stress-test', sentiment_label: 'negative', sentiment_score: 0.33, hoursAgo: 20 },
  ],
  V: [
    { headline: 'Visa cross-border volumes slow as consumer spending cools', source: 'Reuters', url: 'https://reuters.com/visa-volumes', sentiment_label: 'neutral', sentiment_score: 0.35, hoursAgo: 4 },
    { headline: 'Visa launches tokenisation platform for e-commerce merchants', source: 'CNBC', url: 'https://cnbc.com/visa-token', sentiment_label: 'positive', sentiment_score: 0.58, hoursAgo: 15 },
    { headline: 'Regulators scrutinise Visa debit card interchange fees', source: 'FT', url: 'https://ft.com/visa-fees', sentiment_label: 'negative', sentiment_score: 0.29, hoursAgo: 28 },
  ],
  AAPL: [
    { headline: 'Apple iPhone sales miss in China amid Huawei competition', source: 'Bloomberg', url: 'https://bloomberg.com/aapl-china', sentiment_label: 'negative', sentiment_score: 0.22, hoursAgo: 2 },
    { headline: 'Apple Vision Pro 2 rumoured for early 2026 launch', source: 'MacRumors', url: 'https://macrumors.com/visionpro2', sentiment_label: 'neutral', sentiment_score: 0.50, hoursAgo: 10 },
    { headline: 'India manufacturing ramp reduces Apple supply chain risk', source: 'Reuters', url: 'https://reuters.com/aapl-india', sentiment_label: 'positive', sentiment_score: 0.64, hoursAgo: 18 },
  ],
  JNJ: [
    { headline: 'J&J talc liability ruling raises fresh settlement concerns', source: 'Reuters', url: 'https://reuters.com/jnj-talc', sentiment_label: 'negative', sentiment_score: 0.12, hoursAgo: 1 },
    { headline: 'Johnson & Johnson MedTech segment posts record quarterly revenue', source: 'CNBC', url: 'https://cnbc.com/jnj-medtech', sentiment_label: 'positive', sentiment_score: 0.69, hoursAgo: 12 },
    { headline: 'Darzalex biosimilar threat looms as patent cliff approaches', source: 'FT', url: 'https://ft.com/jnj-biosimilar', sentiment_label: 'negative', sentiment_score: 0.24, hoursAgo: 20 },
  ],
};

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

  // Seed full asset list so /market/assets works without Alpaca credentials
  pipeline.set('papi:assets:all', JSON.stringify(MOCK_ASSETS), 'EX', TTL);

  await pipeline.exec();
  await redis.quit();

  // Seed MongoDB articles collection
  const mongo = new MongoClient(MONGODB_URI);
  try {
    await mongo.connect();
    const col = mongo.db('yana_stocks').collection('articles');
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
    // Replace existing dev articles — delete by seeded marker, then insert
    await col.deleteMany({ source: { $in: ['Reuters', 'Bloomberg', 'CNBC', 'WSJ', 'TechCrunch', 'FT', 'Guardian', 'MacRumors', 'Bloomberg'] } });
    await col.insertMany(articles);
    console.log(`Seeded ${articles.length} news articles into MongoDB (yana_stocks.articles)\n`);
  } catch (err) {
    console.warn(`MongoDB news seed skipped: ${String(err)}`);
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
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
