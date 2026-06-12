/**
 * Seed Redis with realistic price data for local development.
 * Run: pnpm --filter portfolio-api seed
 *
 * Populates papi:price:<SYMBOL> keys so /market/movers, /stocks/:symbol,
 * and the frontend dashboard show real-looking data without needing Kafka.
 */
import 'dotenv/config';
import Redis from 'ioredis';
import type { PriceCacheEntry } from '../stocks/price-cache.types';

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const TTL = 3600; // 1 hour — long enough to survive dev session restarts

const STOCKS: Array<{ symbol: string; price: number; changePercent: number; volume: number }> = [
  { symbol: 'NVDA', price: 134.25, changePercent: 4.82, volume: 41_200_000 },
  { symbol: 'TSLA', price: 248.5, changePercent: 3.17, volume: 98_700_000 },
  { symbol: 'META', price: 592.3, changePercent: 2.44, volume: 18_300_000 },
  { symbol: 'AMZN', price: 214.6, changePercent: 1.89, volume: 35_600_000 },
  { symbol: 'GOOGL', price: 178.9, changePercent: 0.73, volume: 22_100_000 },
  { symbol: 'MSFT', price: 445.2, changePercent: 0.41, volume: 19_800_000 },
  { symbol: 'JPM', price: 231.4, changePercent: -0.38, volume: 11_200_000 },
  { symbol: 'V', price: 298.75, changePercent: -1.12, volume: 7_400_000 },
  { symbol: 'AAPL', price: 213.18, changePercent: -2.65, volume: 54_300_000 },
  { symbol: 'JNJ', price: 152.3, changePercent: -3.91, volume: 9_100_000 },
];

async function seed(): Promise<void> {
  const redis = new Redis(REDIS_URL);

  const now = new Date().toISOString();

  const pipeline = redis.pipeline();

  for (const { symbol, price, changePercent, volume } of STOCKS) {
    const change = parseFloat(((price * changePercent) / (100 + changePercent)).toFixed(2));
    const prevPrice = parseFloat((price - change).toFixed(2));

    const entry: PriceCacheEntry = {
      price,
      prevPrice,
      change,
      changePercent,
      volume,
      timestamp: now,
    };

    pipeline.set(`papi:price:${symbol}`, JSON.stringify(entry), 'EX', TTL);
  }

  // Bust the movers cache so getMovers() recomputes on next request
  pipeline.del('papi:movers');

  await pipeline.exec();
  await redis.quit();

  console.log(`Seeded ${STOCKS.length} symbols into Redis (${REDIS_URL})`);
  for (const { symbol, price, changePercent } of STOCKS) {
    const sign = changePercent >= 0 ? '+' : '';
    console.log(`  ${symbol.padEnd(6)} $${price.toFixed(2).padStart(8)}  ${sign}${changePercent.toFixed(2)}%`);
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
