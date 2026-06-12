import { test, expect } from '@playwright/test';
import { RegisterPage } from '../pages/auth.page';
import { HomePage } from '../pages/home.page';
import { StockPage } from '../pages/stock.page';

const PASSWORD = 'Test1234!';

test.describe('Stock data display', () => {
  test('home page renders market overview', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await expect(page.locator('h1', { hasText: 'Stock Market Dashboard' })).toBeVisible();
    await expect(home.searchInput).toBeVisible();
  });

  test('searching a symbol navigates to stock page', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await home.searchSymbol('AAPL');
    await page.waitForURL('**/stocks/AAPL', { timeout: 5_000 });
    await expect(page).toHaveURL(/\/stocks\/AAPL/);
  });

  test('stock page shows symbol heading', async ({ page }) => {
    const stockPage = new StockPage(page);
    await stockPage.goto('AAPL');
    await expect(stockPage.symbolHeading()).toContainText('AAPL', { timeout: 5_000 });
  });

  test('stock page renders price chart section', async ({ page }) => {
    const stockPage = new StockPage(page);
    await stockPage.goto('AAPL');
    await expect(stockPage.priceChart).toBeVisible({ timeout: 10_000 });
  });

  test('stock page renders sentiment and predictions panels', async ({ page }) => {
    const stockPage = new StockPage(page);
    await stockPage.goto('AAPL');
    await expect(stockPage.sentimentPanel).toBeVisible({ timeout: 10_000 });
    await expect(stockPage.predictionsPanel).toBeVisible({ timeout: 10_000 });
  });

  test('direct URL navigation to unknown symbol shows empty state gracefully', async ({ page }) => {
    const stockPage = new StockPage(page);
    await stockPage.goto('ZZZNOTREAL');
    await expect(stockPage.symbolHeading()).toContainText('ZZZNOTREAL', { timeout: 5_000 });
    await expect(
      page
        .locator('text=No price history available')
        .or(page.locator('text=No price data'))
        .first(),
    ).toBeVisible({
      timeout: 10_000,
    });
  });
});

// These tests require auth — the data endpoints return 401 without a JWT.
test.describe('Stock data content', () => {
  let testEmail: string;
  let savedTokens: { at: string; rt: string } | null = null;

  test.beforeAll(async ({ browser }) => {
    testEmail = `e2e+stock+${Date.now()}@example.com`;
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

  test('shows price for a seeded symbol', async ({ page }) => {
    const stockPage = new StockPage(page);
    await stockPage.goto('AAPL');
    // Price should be visible, not the "No price data" fallback
    await expect(page.locator('span.text-xl.font-semibold')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('span.text-xl.font-semibold')).toContainText('$');
  });

  test('shows change percentage for a seeded symbol', async ({ page }) => {
    const stockPage = new StockPage(page);
    await stockPage.goto('AAPL');
    // Wait for the price to load first, then the change % will be alongside it
    await expect(page.locator('span.text-xl.font-semibold')).toBeVisible({ timeout: 10_000 });
    // AAPL seeded with -2.65% — the change % sits next to the price
    await expect(page.locator('span.text-sm.font-medium.text-red-400')).toBeVisible({
      timeout: 5_000,
    });
  });

  test('sentiment panel shows a label badge', async ({ page }) => {
    const stockPage = new StockPage(page);
    await stockPage.goto('AAPL');
    await expect(stockPage.sentimentPanel).toBeVisible({ timeout: 10_000 });
    await expect(stockPage.sentimentLabel).toBeVisible({ timeout: 10_000 });
  });

  test('sentiment panel shows headline text', async ({ page }) => {
    const stockPage = new StockPage(page);
    await stockPage.goto('AAPL');
    await expect(stockPage.sentimentHeadline).toBeVisible({ timeout: 10_000 });
    const text = await stockPage.sentimentHeadline.textContent();
    expect(text?.length).toBeGreaterThan(10);
  });

  test('predictions panel shows at least one horizon card', async ({ page }) => {
    const stockPage = new StockPage(page);
    await stockPage.goto('AAPL');
    await expect(stockPage.predictionsPanel).toBeVisible({ timeout: 10_000 });
    // Seed writes predictions for 1h, 4h, 1d, 1w
    await expect(stockPage.predictionCard('1 Day')).toBeVisible({ timeout: 10_000 });
  });

  test('prediction card shows predicted price', async ({ page }) => {
    const stockPage = new StockPage(page);
    await stockPage.goto('AAPL');
    const card = stockPage.predictionCard('1 Day');
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.locator('div.text-base')).toContainText('$');
  });

  test('positive sentiment symbol shows green label', async ({ page }) => {
    const stockPage = new StockPage(page);
    await stockPage.goto('NVDA'); // seeded positive
    await expect(stockPage.sentimentPanel).toBeVisible({ timeout: 10_000 });
    const label = page.locator('span.bg-green-900');
    await expect(label).toBeVisible({ timeout: 10_000 });
    await expect(label).toContainText(/positive/i);
  });

  test('negative sentiment symbol shows red label', async ({ page }) => {
    const stockPage = new StockPage(page);
    await stockPage.goto('JNJ'); // seeded negative
    await expect(stockPage.sentimentPanel).toBeVisible({ timeout: 10_000 });
    const label = page.locator('span.bg-red-900');
    await expect(label).toBeVisible({ timeout: 10_000 });
    await expect(label).toContainText(/negative/i);
  });
});
