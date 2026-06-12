import { test, expect } from '@playwright/test';
import { RegisterPage } from '../pages/auth.page';
import { WatchlistPage } from '../pages/watchlist.page';

const PASSWORD = 'Test1234!';

test.describe('Watchlist management', () => {
  let testEmail: string;
  let savedTokens: { at: string; rt: string } | null = null;

  test.beforeAll(async ({ browser }) => {
    testEmail = `e2e+watchlist+${Date.now()}@example.com`;
    const page = await browser.newPage();
    const registerPage = new RegisterPage(page);
    await registerPage.goto();
    await registerPage.register(testEmail, PASSWORD);
    await page.waitForURL('**/dashboard', { timeout: 30_000, waitUntil: 'commit' });
    savedTokens = await page.evaluate(() => ({
      at: localStorage.getItem('access_token') ?? '',
      rt: localStorage.getItem('refresh_token') ?? '',
    }));
    await page.close();
  });

  test.beforeEach(async ({ page }) => {
    // Inject tokens directly — avoids slow mobile-safari UI login on every test
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ at, rt }) => {
      localStorage.setItem('access_token', at);
      localStorage.setItem('refresh_token', rt);
    }, savedTokens!);
  });

  test('redirects unauthenticated user to login', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
    });
    await page.goto('/watchlist');
    await page.waitForURL('**/login', { timeout: 5_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test('shows Watchlists heading', async ({ page }) => {
    const watchlistPage = new WatchlistPage(page);
    await watchlistPage.goto();
    await expect(watchlistPage.heading).toBeVisible({ timeout: 5_000 });
  });

  test('shows empty state when no watchlists exist', async ({ page }) => {
    const watchlistPage = new WatchlistPage(page);
    await watchlistPage.goto();
    await expect(watchlistPage.emptyState).toBeVisible({ timeout: 5_000 });
  });

  test('creates a watchlist and shows it', async ({ page }) => {
    const watchlistPage = new WatchlistPage(page);
    const name = `My Watchlist ${Date.now()}`;

    await watchlistPage.goto();
    await watchlistPage.createWatchlist(name);
    await expect(page.locator('h3', { hasText: name })).toBeVisible({ timeout: 5_000 });
  });

  test('new watchlist shows empty symbols state', async ({ page }) => {
    const watchlistPage = new WatchlistPage(page);
    const name = `Empty Watch ${Date.now()}`;

    await watchlistPage.goto();
    await watchlistPage.createWatchlist(name);
    const card = watchlistPage.watchlistCard(name);
    await expect(card.locator('text=No symbols yet')).toBeVisible({ timeout: 5_000 });
  });

  test('adds a symbol to a watchlist', async ({ page }) => {
    const watchlistPage = new WatchlistPage(page);
    const name = `Tech Watch ${Date.now()}`;

    await watchlistPage.goto();
    await watchlistPage.createWatchlist(name);
    await expect(page.locator('h3', { hasText: name })).toBeVisible({ timeout: 5_000 });

    await watchlistPage.openAddSymbol(name);
    await watchlistPage.addSymbol('NVDA');

    await expect(page.locator('a', { hasText: 'NVDA' })).toBeVisible({ timeout: 5_000 });
  });

  test('watchlist symbol is a link that navigates to the stock page', async ({ page }) => {
    const watchlistPage = new WatchlistPage(page);
    const name = `Nav Watch ${Date.now()}`;

    await watchlistPage.goto();
    await watchlistPage.createWatchlist(name);
    await expect(page.locator('h3', { hasText: name })).toBeVisible({ timeout: 5_000 });

    await watchlistPage.openAddSymbol(name);
    await watchlistPage.addSymbol('AAPL');

    await page.locator('a', { hasText: 'AAPL' }).click();
    await page.waitForURL('**/stocks/AAPL', { timeout: 5_000 });
    await expect(page).toHaveURL(/\/stocks\/AAPL/);
  });

  test('can add multiple symbols to a watchlist', async ({ page }) => {
    const watchlistPage = new WatchlistPage(page);
    const name = `Multi Watch ${Date.now()}`;

    await watchlistPage.goto();
    await watchlistPage.createWatchlist(name);
    await expect(page.locator('h3', { hasText: name })).toBeVisible({ timeout: 5_000 });

    for (const symbol of ['MSFT', 'TSLA']) {
      await watchlistPage.openAddSymbol(name);
      await watchlistPage.addSymbol(symbol);
      await expect(page.locator('a', { hasText: symbol })).toBeVisible({ timeout: 5_000 });
    }
  });
});
