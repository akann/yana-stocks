import { test, expect } from '@playwright/test';
import { RegisterPage } from '../pages/auth.page';
import { HomePage } from '../pages/home.page';

const PASSWORD = 'Test1234!';

// Market movers endpoint requires auth — tests run with a logged-in user.
test.describe('Market movers', () => {
  let testEmail: string;
  let savedTokens: { at: string; rt: string } | null = null;

  test.beforeAll(async ({ browser }) => {
    testEmail = `e2e+market+${Date.now()}@example.com`;
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

  test('home page shows Top Gainers and Top Losers sections', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await expect(home.gainersSection).toBeVisible({ timeout: 10_000 });
    await expect(home.losersSection).toBeVisible({ timeout: 10_000 });
  });

  test('Top Gainers shows at least one stock', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await expect(home.gainersSection).toBeVisible({ timeout: 10_000 });
    const firstGainer = home.firstGainerLink();
    await expect(firstGainer).toBeVisible({ timeout: 10_000 });
  });

  test('Top Losers shows at least one stock', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await expect(home.losersSection).toBeVisible({ timeout: 10_000 });
    const firstLoser = home.firstLoserLink();
    await expect(firstLoser).toBeVisible({ timeout: 10_000 });
  });

  test('gainers show green positive percentages', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await expect(home.gainersSection).toBeVisible({ timeout: 10_000 });

    const gainersContainer = home.gainersSection.locator('../..');
    const greenPercent = gainersContainer.locator('.text-green-400').first();
    await expect(greenPercent).toBeVisible({ timeout: 5_000 });
    await expect(greenPercent).toContainText('+');
  });

  test('losers show red negative percentages', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await expect(home.losersSection).toBeVisible({ timeout: 10_000 });

    const losersContainer = home.losersSection.locator('../..');
    const redPercent = losersContainer.locator('.text-red-400').first();
    await expect(redPercent).toBeVisible({ timeout: 5_000 });
    await expect(redPercent).toContainText('-');
  });

  test('clicking a gainer navigates to its stock page', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await expect(home.gainersSection).toBeVisible({ timeout: 10_000 });

    const firstGainer = home.firstGainerLink();
    await expect(firstGainer).toBeVisible({ timeout: 10_000 });

    const symbol = await firstGainer.locator('span.font-medium').textContent();
    await firstGainer.click();
    await page.waitForURL(`**/stocks/${symbol}`, { timeout: 5_000 });
    await expect(page).toHaveURL(new RegExp(`/stocks/${symbol}`));
  });

  test('top gainer shows pronounced positive percentage (≥5%)', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await expect(home.gainersSection).toBeVisible({ timeout: 10_000 });
    const firstGreenPct = home.gainersSection.locator('..').locator('.text-green-400').first();
    await expect(firstGreenPct).toBeVisible({ timeout: 5_000 });
    const text = await firstGreenPct.textContent();
    const pct = parseFloat(text?.replace('+', '').replace('%', '') ?? '0');
    expect(pct).toBeGreaterThan(5);
  });

  test('top loser shows pronounced negative percentage (≤-5%)', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await expect(home.losersSection).toBeVisible({ timeout: 10_000 });
    const firstRedPct = home.losersSection.locator('..').locator('.text-red-400').first();
    await expect(firstRedPct).toBeVisible({ timeout: 5_000 });
    const text = await firstRedPct.textContent();
    const pct = parseFloat(text?.replace('%', '') ?? '0');
    expect(pct).toBeLessThan(-5);
  });

  test('shows at least 5 gainers and 5 losers', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await expect(home.gainersSection).toBeVisible({ timeout: 10_000 });
    await expect(home.gainerLinks().first()).toBeVisible({ timeout: 5_000 });
    const gainerCount = await home.gainerLinks().count();
    const loserCount = await home.loserLinks().count();
    expect(gainerCount).toBeGreaterThanOrEqual(5);
    expect(loserCount).toBeGreaterThanOrEqual(5);
  });

  test('SMCI appears as top gainer', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await expect(home.gainersSection).toBeVisible({ timeout: 10_000 });
    const firstGainer = home.gainerLinks().first();
    await expect(firstGainer).toBeVisible({ timeout: 5_000 });
    await expect(firstGainer.locator('span.font-medium')).toContainText('SMCI');
  });
});

// Stock Browser is on the same home page and requires the same auth.
test.describe('Stock Browser', () => {
  let testEmail: string;
  let savedTokens: { at: string; rt: string } | null = null;

  test.beforeAll(async ({ browser }) => {
    testEmail = `e2e+browser+${Date.now()}@example.com`;
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
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ at, rt }) => {
      localStorage.setItem('access_token', at);
      localStorage.setItem('refresh_token', rt);
    }, savedTokens!);
  });

  test('renders All Stocks heading and search input', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await expect(home.stockBrowserSection).toBeVisible({ timeout: 10_000 });
    await expect(home.stockBrowserSearch).toBeVisible({ timeout: 5_000 });
  });

  test('table shows at least one stock symbol', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    const firstSymbol = home.stockBrowserTable.locator('tbody td.font-mono').first();
    await expect(firstSymbol).toBeVisible({ timeout: 10_000 });
    const text = await firstSymbol.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });

  test('search filters the stock table', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await expect(home.stockBrowserSearch).toBeVisible({ timeout: 10_000 });
    await home.stockBrowserSearch.fill('SMCI');
    const smciCell = home.stockBrowserTable.locator('tbody td.font-mono', { hasText: 'SMCI' });
    await expect(smciCell).toBeVisible({ timeout: 5_000 });
    const rowCount = await home.stockBrowserTable.locator('tbody tr').count();
    expect(rowCount).toBe(1);
  });

  test('clicking a row navigates to the stock page', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await expect(home.stockBrowserSearch).toBeVisible({ timeout: 10_000 });
    await home.stockBrowserSearch.fill('AAPL');
    const firstRow = home.stockBrowserTable.locator('tbody tr').first();
    await expect(firstRow).toBeVisible({ timeout: 5_000 });
    await firstRow.click();
    await page.waitForURL('**/stocks/AAPL', { timeout: 5_000 });
    await expect(page).toHaveURL(/\/stocks\/AAPL/);
  });
});
