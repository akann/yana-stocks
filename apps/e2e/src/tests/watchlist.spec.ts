import { test, expect } from '../fixtures/base.fixture';
import {
  setupAuthSession,
  mockWatchlistsEndpoint,
  fulfill,
  type WatchlistData,
} from '../fixtures/api-mocks';

async function gotoWatchlistPage(page: import('@playwright/test').Page): Promise<void> {
  await setupAuthSession(page);
  await page.goto('/watchlist');
  await page.waitForLoadState('networkidle');
}

test.describe('Watchlist page — unauthenticated', () => {
  test('redirects to /login when not logged in', async ({ page }) => {
    await page.goto('/watchlist');
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Watchlist page — authenticated, no watchlists', () => {
  test.beforeEach(async ({ page }) => {
    await mockWatchlistsEndpoint(page, []);
  });

  test('shows Watchlists heading and New Watchlist button', async ({ page }) => {
    await gotoWatchlistPage(page);
    await expect(page.getByRole('heading', { name: 'Watchlists' })).toBeVisible();
    await expect(page.getByRole('button', { name: '+ New Watchlist' }).first()).toBeVisible();
  });

  test('shows empty-state message when no watchlists exist', async ({ page }) => {
    await gotoWatchlistPage(page);
    await expect(page.getByText('No watchlists yet')).toBeVisible();
  });

  test('clicking "+ New Watchlist" reveals the create form', async ({ page }) => {
    await gotoWatchlistPage(page);
    await page.getByRole('button', { name: '+ New Watchlist' }).first().click();

    await expect(page.getByText('Create Watchlist')).toBeVisible();
    await expect(page.getByPlaceholder('e.g. AI Stocks')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create' })).toBeVisible();
  });

  test('Cancel hides the create form', async ({ page }) => {
    await gotoWatchlistPage(page);
    await page.getByRole('button', { name: '+ New Watchlist' }).first().click();
    await expect(page.getByText('Create Watchlist')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Create Watchlist')).not.toBeVisible();
  });

  test('Create button is disabled when name input is empty', async ({ page }) => {
    await gotoWatchlistPage(page);
    await page.getByRole('button', { name: '+ New Watchlist' }).first().click();

    await expect(page.getByRole('button', { name: 'Create' })).toBeDisabled();
  });

  test('submitting the form creates a watchlist and shows it in the list', async ({ page }) => {
    // Override: POST creates a watchlist, subsequent GET returns it
    let list: WatchlistData[] = [];
    await page.route(/\/api\/portfolio\/watchlists$/, (route) => {
      if (route.request().method() === 'GET') return fulfill(route, list);
      list = [{ id: 'wl-1', name: 'AI Stocks', symbols: [] }];
      return fulfill(route, list[0], 201);
    });

    await gotoWatchlistPage(page);
    await page.getByRole('button', { name: '+ New Watchlist' }).first().click();
    await page.getByPlaceholder('e.g. AI Stocks').fill('AI Stocks');
    await page.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByText('AI Stocks')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Create Watchlist')).not.toBeVisible();
  });
});

test.describe('Watchlist page — authenticated, with existing watchlist', () => {
  const existing: WatchlistData = { id: 'wl-1', name: 'Tech Stocks', symbols: ['AAPL', 'MSFT'] };

  test.beforeEach(async ({ page }) => {
    await mockWatchlistsEndpoint(page, [existing]);
    await page.route(/\/api\/stocks\/AAPL$/, (route) =>
      fulfill(route, {
        symbol: 'AAPL',
        price: 180,
        change: 5,
        changePercent: 2.8,
        volume: 800_000,
      }),
    );
    await page.route(/\/api\/stocks\/MSFT$/, (route) =>
      fulfill(route, {
        symbol: 'MSFT',
        price: 420,
        change: 3,
        changePercent: 0.7,
        volume: 500_000,
      }),
    );
  });

  test('shows watchlist name and its symbols', async ({ page }) => {
    await gotoWatchlistPage(page);
    await expect(page.getByText('Tech Stocks')).toBeVisible();
    await expect(page.getByText('AAPL')).toBeVisible();
    await expect(page.getByText('MSFT')).toBeVisible();
  });

  test('shows live prices for watched symbols', async ({ page }) => {
    await gotoWatchlistPage(page);
    await expect(page.getByText('$180.00')).toBeVisible();
    await expect(page.getByText('$420.00')).toBeVisible();
  });

  test('clicking a symbol navigates to its stock page', async ({ page }) => {
    // The stock page needs its own mocks
    await page.route(/\/api\/stocks\/AAPL\/history/, (route) => fulfill(route, []));
    await page.route(/\/api\/signals\/AAPL$/, (route) =>
      fulfill(route, { symbol: 'AAPL', sentiment: null, prediction: null }),
    );
    await page.route(/\/api\/predict\/AAPL$/, (route) =>
      fulfill(route, { symbol: 'AAPL', predictions: [] }),
    );
    await page.route(/\/api\/news\/AAPL$/, (route) => fulfill(route, []));

    await gotoWatchlistPage(page);
    await page.getByRole('cell', { name: 'AAPL' }).click();
    await page.waitForURL(/\/stocks\/AAPL/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/stocks\/AAPL/);
  });
});
