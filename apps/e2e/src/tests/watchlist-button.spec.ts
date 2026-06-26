import { test, expect, setupStockMocks } from '../fixtures/base.fixture';
import { mockMovers, fulfill } from '../fixtures/api-mocks';

const WATCHLIST_1 = {
  id: 'wl-1',
  name: 'My Stocks',
  symbols: [],
  userId: 'u1',
  createdAt: '',
  updatedAt: '',
};
const WATCHLIST_2 = {
  id: 'wl-2',
  name: 'Tech Plays',
  symbols: [],
  userId: 'u1',
  createdAt: '',
  updatedAt: '',
};

test.describe('AddToWatchlistButton', () => {
  test('+ button is visible for every mover entry on the home page', async ({ page }) => {
    await mockMovers(page);
    await page.goto('/');

    await expect(page.getByText('NVDA').first()).toBeVisible();
    await expect(page.getByTitle('Add NVDA to watchlist')).toBeVisible();
    await expect(page.getByTitle('Add AAPL to watchlist')).toBeVisible();
    await expect(page.getByTitle('Add TSLA to watchlist')).toBeVisible();
  });

  test('unauthenticated click on + navigates to /login', async ({ page }) => {
    await mockMovers(page);
    await page.goto('/');

    await expect(page.getByText('NVDA').first()).toBeVisible();
    await page.getByTitle('Add NVDA to watchlist').click();
    await page.waitForURL(/\/login/, { timeout: 5_000 });

    await expect(page).toHaveURL(/\/login/);
  });

  test('authenticated, single watchlist: + on stock page immediately adds and shows ✓', async ({
    page,
  }) => {
    await setupStockMocks(page);
    // Override the default empty-watchlists mock with a single watchlist
    await page.route(/\/api\/portfolio\/watchlists$/, (route) => {
      if (route.request().method() === 'GET') return fulfill(route, [WATCHLIST_1]);
      return fulfill(route, WATCHLIST_1, 201);
    });
    await page.route(/\/api\/portfolio\/watchlists\/wl-1\/symbols$/, (route) =>
      fulfill(route, {}, 201),
    );

    await page.goto('/stocks/NVDA');
    await expect(page.getByText('NVDA').first()).toBeVisible();

    const addBtn = page.getByTitle('Add NVDA to watchlist');
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    await expect(addBtn).toHaveText('✓', { timeout: 5_000 });
  });

  test('authenticated, multiple watchlists: + opens a dropdown with watchlist names', async ({
    page,
  }) => {
    await setupStockMocks(page);
    await page.route(/\/api\/portfolio\/watchlists$/, (route) =>
      fulfill(route, [WATCHLIST_1, WATCHLIST_2]),
    );

    await page.goto('/stocks/NVDA');
    await expect(page.getByText('NVDA').first()).toBeVisible();

    const addBtn = page.getByTitle('Add NVDA to watchlist');
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    await expect(page.getByText('My Stocks')).toBeVisible();
    await expect(page.getByText('Tech Plays')).toBeVisible();
  });

  test('clicking a dropdown item calls the add endpoint and shows ✓', async ({ page }) => {
    await setupStockMocks(page);
    await page.route(/\/api\/portfolio\/watchlists$/, (route) =>
      fulfill(route, [WATCHLIST_1, WATCHLIST_2]),
    );
    await page.route(/\/api\/portfolio\/watchlists\/wl-2\/symbols$/, (route) =>
      fulfill(route, {}, 201),
    );

    // Register the response waiter before goto so we don't miss the request.
    // This guarantees both [W1, W2] are in the TanStack Query cache before we click,
    // complementing disabled={authLoading || watchlistsLoading} on the + button.
    const watchlistsResponse = page.waitForResponse(
      (r) => /\/api\/portfolio\/watchlists$/.test(r.url()) && r.request().method() === 'GET',
    );

    await page.goto('/stocks/NVDA');
    await expect(page.getByText('NVDA').first()).toBeVisible();
    await watchlistsResponse;

    await page.getByTitle('Add NVDA to watchlist').click();
    await expect(page.getByRole('button', { name: 'Tech Plays' })).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Tech Plays' }).dispatchEvent('click');

    await expect(page.getByTitle('Add NVDA to watchlist')).toHaveText('✓', { timeout: 5_000 });
  });
});
