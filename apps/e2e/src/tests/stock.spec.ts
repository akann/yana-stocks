import { test, expect } from '@playwright/test';
import { HomePage } from '../pages/home.page';
import { StockPage } from '../pages/stock.page';

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

  test('stock page is accessible without login', async ({ page }) => {
    await page.goto('/stocks/MSFT');
    await expect(page.locator('h1', { hasText: 'MSFT' })).toBeVisible({ timeout: 5_000 });
  });

  test('direct URL navigation to unknown symbol shows empty state gracefully', async ({ page }) => {
    const stockPage = new StockPage(page);
    await stockPage.goto('ZZZNOTREAL');
    await expect(stockPage.symbolHeading()).toContainText('ZZZNOTREAL', { timeout: 5_000 });
    await expect(page.locator('text=No price history available').or(page.locator('text=No price data'))).toBeVisible({
      timeout: 10_000,
    });
  });
});
