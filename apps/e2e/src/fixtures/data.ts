export const MOCK_ACCESS_TOKEN = 'mock-access-token-e2e';
export const MOCK_REFRESH_TOKEN = 'mock-refresh-token-e2e';
export const TEST_PASSWORD = 'Password123!';

let _seq = Date.now();
export function uniqueEmail(): string {
  return `e2e+${++_seq}@yana-test.local`;
}

export function makePortfolio(name = 'Test Portfolio') {
  return {
    id: 'portfolio-1',
    userId: 'user-1',
    name,
    stocks: [] as { symbol: string; shares: number; avgCostBasis: number }[],
    totalValue: 0,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  };
}

export function makePortfolioWithStock(name = 'Test Portfolio') {
  return {
    id: 'portfolio-1',
    userId: 'user-1',
    name,
    stocks: [{ symbol: 'AAPL', shares: 10, avgCostBasis: 175.0 }],
    totalValue: 1855.0,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  };
}

export function makeWatchlist(name = 'Test Watchlist') {
  return {
    id: 'watchlist-1',
    userId: 'user-1',
    name,
    symbols: [] as string[],
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  };
}

export const MOCK_STOCK_AAPL = {
  symbol: 'AAPL',
  price: 185.5,
  change: 2.3,
  changePercent: 1.26,
  volume: 52_300_000,
  timestamp: '2025-01-01T16:00:00.000Z',
  sentiment: {
    symbol: 'AAPL',
    score: 0.72,
    label: 'positive',
    source: 'newsapi',
    headline: 'Apple reports record Q4 earnings',
    publishedAt: '2025-01-01T12:00:00.000Z',
    analyzedAt: '2025-01-01T12:05:00.000Z',
  },
  prediction: null,
};

export const MOCK_SIGNALS_AAPL = {
  symbol: 'AAPL',
  sentiment: {
    symbol: 'AAPL',
    score: 0.72,
    label: 'positive',
    source: 'newsapi',
    headline: 'Apple reports record Q4 earnings',
    publishedAt: '2025-01-01T12:00:00.000Z',
    analyzedAt: '2025-01-01T12:05:00.000Z',
  },
  prediction: null,
};

export const MOCK_PREDICTIONS_AAPL = {
  symbol: 'AAPL',
  predictions: [
    {
      symbol: 'AAPL',
      currentPrice: 185.5,
      predictedPrice: 190.0,
      confidence: 0.81,
      horizon: '1d' as const,
      model: 'prophet-v1',
      generatedAt: '2025-01-01T00:00:00.000Z',
    },
  ],
};

export const MOCK_MARKET_MOVERS = {
  gainers: [
    { symbol: 'NVDA', price: 620.0, change: 15.5, changePercent: 2.56, volume: 30_000_000 },
    { symbol: 'TSLA', price: 245.0, change: 8.2, changePercent: 3.47, volume: 42_000_000 },
  ],
  losers: [
    { symbol: 'META', price: 380.0, change: -5.5, changePercent: -1.43, volume: 18_000_000 },
  ],
};

export const MOCK_ASSETS_PAGE = {
  data: [
    { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', tradable: true },
    { symbol: 'GOOGL', name: 'Alphabet Inc.', exchange: 'NASDAQ', tradable: true },
    { symbol: 'MSFT', name: 'Microsoft Corporation', exchange: 'NASDAQ', tradable: true },
  ],
  total: 3,
  page: 1,
  limit: 20,
};
