import type { Page, Route } from '@playwright/test';

export const MOCK_USER = { userId: 'user-1', email: 'test@test.com' };
export const MOCK_PROFILE = {
  displayName: 'Test User',
  avatar: '',
  bio: '',
  preferences: { theme: 'light', defaultCurrency: 'USD', emailNotifications: false },
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
