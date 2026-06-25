import { test as base, expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { makeMinuteBars, makeDailyBars, type MockOHLCVBar } from './chart-data';

export type HistoryFactory = (limit: number, interval: string) => MockOHLCVBar[];

const defaultHistoryFactory: HistoryFactory = (limit, interval) =>
  interval === '1d' ? makeDailyBars(limit) : makeMinuteBars(limit);

const MOCK_USER = { userId: 'user-1', email: 'test@test.com' };
const MOCK_PROFILE = {
  displayName: 'Test User',
  avatar: '',
  bio: '',
  preferences: { theme: 'light', defaultCurrency: 'USD', emailNotifications: false },
};
const MOCK_STOCK = { symbol: 'NVDA', price: 500.0, change: 5.0, changePercent: 1.0 };
const MOCK_SIGNALS = { symbol: 'NVDA', sentiment: null, prediction: null };
const MOCK_PREDICT = { symbol: 'NVDA', predictions: [] };
const MOCK_NEWS: unknown[] = [];

// Seeds sessionStorage tokens before the page script runs (via addInitScript).
export async function seedAuth(page: Page): Promise<void> {
  await page.addInitScript(() => {
    sessionStorage.setItem('access_token', 'mock-access-token');
    sessionStorage.setItem('refresh_token', 'mock-refresh-token');
  });
}

function fulfill(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

// Registers all route mocks required for the /stocks/NVDA page.
// Must be called before page.goto().
export async function setupStockMocks(
  page: Page,
  historyFactory: HistoryFactory = defaultHistoryFactory,
): Promise<void> {
  await seedAuth(page);

  await page.route(/\/api\/auth\/me$/, (route) => fulfill(route, MOCK_USER));
  await page.route(/\/api\/profile\/me$/, (route) => fulfill(route, MOCK_PROFILE));
  await page.route(/\/api\/stocks\/NVDA$/, (route) => fulfill(route, MOCK_STOCK));
  await page.route(/\/api\/signals\/NVDA$/, (route) => fulfill(route, MOCK_SIGNALS));
  await page.route(/\/api\/predict\/NVDA$/, (route) => fulfill(route, MOCK_PREDICT));
  await page.route(/\/api\/news\/NVDA$/, (route) => fulfill(route, MOCK_NEWS));

  await page.route(/\/api\/stocks\/NVDA\/history/, (route) => {
    const url = new URL(route.request().url());
    const interval = url.searchParams.get('interval') ?? '1m';
    const limit = parseInt(url.searchParams.get('limit') ?? '60', 10);
    return fulfill(route, historyFactory(limit, interval));
  });
}

// Extended test fixture that automatically collects JS page errors.
// Access via `jsErrors` param; assert `expect(jsErrors).toHaveLength(0)` to catch crashes.
export const test = base.extend<{ jsErrors: string[] }>({
  jsErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(err.message));
      await use(errors);
    },
    { auto: true },
  ],
});

export { expect };
