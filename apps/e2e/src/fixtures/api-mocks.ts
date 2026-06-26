import type { Page, Route } from '@playwright/test';

export const MOCK_USER = { userId: 'user-1', email: 'test@test.com' };
export const MOCK_PROFILE = {
  displayName: 'Test User',
  avatar: '',
  bio: '',
  preferences: {
    theme: 'light',
    defaultCurrency: 'USD',
    emailNotifications: false,
    defaultMarket: 'US',
  },
};
export const MOCK_MOVERS = {
  gainers: [
    { symbol: 'NVDA', price: 194.92, change: 10.5, changePercent: 5.7, volume: 1_200_000 },
    { symbol: 'AAPL', price: 180.0, change: 5.0, changePercent: 2.86, volume: 800_000 },
  ],
  losers: [{ symbol: 'TSLA', price: 150.0, change: -20.0, changePercent: -11.76, volume: 600_000 }],
};

export function fulfill(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

/** Seeds sessionStorage and mocks /auth/me + /profile/me for an authenticated session. */
export async function setupAuthSession(page: Page): Promise<void> {
  await page.addInitScript(() => {
    sessionStorage.setItem('access_token', 'mock-access-token');
    sessionStorage.setItem('refresh_token', 'mock-refresh-token');
  });
  await page.route(/\/api\/auth\/me$/, (route) => fulfill(route, MOCK_USER));
  await page.route(/\/api\/profile\/me$/, (route) => fulfill(route, MOCK_PROFILE));
}

/** Mocks the /market/movers endpoint with optional custom data. */
export async function mockMovers(page: Page, movers = MOCK_MOVERS): Promise<void> {
  await page.route(/\/api\/market\/movers/, (route) => fulfill(route, movers));
}

/** Mocks GET + POST /api/portfolio/watchlists. POST appends to the mutable list. */
export async function mockWatchlistsEndpoint(
  page: Page,
  initial: WatchlistData[] = [],
): Promise<WatchlistData[]> {
  const list: WatchlistData[] = [...initial];
  await page.route(/\/api\/portfolio\/watchlists$/, (route) => {
    if (route.request().method() === 'GET') return fulfill(route, list);
    const body = JSON.parse(route.request().postData() ?? '{}') as { name?: string };
    const created: WatchlistData = {
      id: `wl-${Date.now()}`,
      name: body.name ?? 'New',
      symbols: [],
    };
    list.push(created);
    return fulfill(route, created, 201);
  });
  return list;
}

/** Mocks GET + POST /api/portfolio/portfolios. POST appends to the mutable list. */
export async function mockPortfoliosEndpoint(
  page: Page,
  initial: PortfolioData[] = [],
): Promise<PortfolioData[]> {
  const list: PortfolioData[] = [...initial];
  await page.route(/\/api\/portfolio\/portfolios$/, (route) => {
    if (route.request().method() === 'GET') return fulfill(route, list);
    const body = JSON.parse(route.request().postData() ?? '{}') as { name?: string };
    const created: PortfolioData = {
      id: `p-${Date.now()}`,
      name: body.name ?? 'New',
      stocks: [],
      totalValue: 0,
    };
    list.push(created);
    return fulfill(route, created, 201);
  });
  return list;
}

export interface AssetPage {
  data: { symbol: string; name: string; exchange: string; tradable: boolean; assetClass: string }[];
  total: number;
  page: number;
  limit: number;
}

export const MOCK_US_ASSETS_PAGE: AssetPage = {
  data: [
    {
      symbol: 'AAPL',
      name: 'Apple Inc.',
      exchange: 'NASDAQ',
      tradable: true,
      assetClass: 'us_equity',
    },
    {
      symbol: 'MSFT',
      name: 'Microsoft Corporation',
      exchange: 'NASDAQ',
      tradable: true,
      assetClass: 'us_equity',
    },
    {
      symbol: 'NVDA',
      name: 'NVIDIA Corporation',
      exchange: 'NASDAQ',
      tradable: true,
      assetClass: 'us_equity',
    },
  ],
  total: 3,
  page: 1,
  limit: 20,
};

export const MOCK_ETF_ASSETS_PAGE: AssetPage = {
  data: [
    {
      symbol: 'SPY',
      name: 'SPDR S&P 500 ETF Trust',
      exchange: 'NYSE ARCA',
      tradable: true,
      assetClass: 'us_etf',
    },
    {
      symbol: 'QQQ',
      name: 'Invesco QQQ Trust Series 1',
      exchange: 'NASDAQ',
      tradable: true,
      assetClass: 'us_etf',
    },
  ],
  total: 2,
  page: 1,
  limit: 20,
};

export const MOCK_UK_ASSETS_PAGE: AssetPage = {
  data: [
    {
      symbol: 'HSBA.L',
      name: 'HSBC Holdings plc',
      exchange: 'LSE',
      tradable: true,
      assetClass: 'uk_equity',
    },
    {
      symbol: 'BARC.L',
      name: 'Barclays plc',
      exchange: 'LSE',
      tradable: true,
      assetClass: 'uk_equity',
    },
    { symbol: 'BP.L', name: 'BP plc', exchange: 'LSE', tradable: true, assetClass: 'uk_equity' },
  ],
  total: 3,
  page: 1,
  limit: 20,
};

/** Mocks /api/market/assets, routing by the `market` query param. */
export async function mockAssets(page: Page): Promise<void> {
  await page.route(/\/api\/market\/assets/, (route) => {
    const url = new URL(route.request().url());
    const market = url.searchParams.get('market') ?? 'us';
    if (market === 'uk') return fulfill(route, MOCK_UK_ASSETS_PAGE);
    if (market === 'etf') return fulfill(route, MOCK_ETF_ASSETS_PAGE);
    return fulfill(route, MOCK_US_ASSETS_PAGE);
  });
}

export interface WatchlistData {
  id: string;
  name: string;
  symbols: string[];
}

export interface PortfolioData {
  id: string;
  name: string;
  stocks: { symbol: string; shares: number; avgCostBasis: number }[];
  totalValue?: number;
}
