import { test, expect } from '../fixtures/base.fixture';
import {
  mockMovers,
  mockMarketOverview,
  mockAssets,
  mockSectorRotation,
  mockScreener,
  setupAuthSession,
  fulfill,
} from '../fixtures/api-mocks';

async function setupHomeFullMocks(page: import('@playwright/test').Page): Promise<void> {
  await mockMovers(page);
  await mockMarketOverview(page);
  await mockSectorRotation(page);
  await mockAssets(page);
  await mockScreener(page);
  await page.route(/\/api\/portfolio\/watchlists$/, (route) => fulfill(route, []));
}

// Screener sits inside a tab that is hidden on mobile viewports.
test.use({ viewport: { width: 1280, height: 900 } });

test.describe('Stock Screener', () => {
  test('"Stock Screener" tab button is visible on the home page', async ({ page }) => {
    await setupHomeFullMocks(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('button', { name: 'Stock Screener' })).toBeVisible();
  });

  test('clicking Stock Screener tab shows the "Stock Screener" heading', async ({ page }) => {
    await setupHomeFullMocks(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Stock Screener' }).click();
    await page.waitForTimeout(300);

    await expect(page.getByRole('heading', { name: 'Stock Screener' })).toBeVisible();
  });

  test('screener panel shows Market Cap filter label', async ({ page }) => {
    await setupHomeFullMocks(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Stock Screener' }).click();
    await page.waitForTimeout(300);

    await expect(page.getByText('Market Cap')).toBeVisible();
  });

  test('screener panel shows Min Volume filter label', async ({ page }) => {
    await setupHomeFullMocks(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Stock Screener' }).click();
    await page.waitForTimeout(300);

    await expect(page.getByText('Min Volume')).toBeVisible();
  });

  test('screener panel shows Sector filter label', async ({ page }) => {
    await setupHomeFullMocks(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Stock Screener' }).click();
    await page.waitForTimeout(300);

    // exact: true so we match the <label>Sector</label> filter, not "Sector Rotation" heading.
    await expect(page.getByText('Sector', { exact: true })).toBeVisible();
  });

  test('renders result rows from mocked screener endpoint', async ({ page }) => {
    await setupHomeFullMocks(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Stock Screener' }).click();
    await page.waitForTimeout(400);

    // MOCK_SCREENER_RESULTS contains AAPL and MSFT.
    // exact: true targets only the screener row ticker link (not the movers card link for AAPL
    // whose accessible name includes price/change text).
    await expect(page.getByRole('link', { name: 'AAPL', exact: true })).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByRole('link', { name: 'MSFT', exact: true })).toBeVisible({
      timeout: 5_000,
    });
  });

  test('each screener result row has an Add to Watchlist button', async ({ page }) => {
    await setupHomeFullMocks(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Stock Screener' }).click();
    await page.waitForTimeout(400);

    // Two "Add AAPL to watchlist" buttons can exist (movers card + screener row). first() is enough.
    await expect(page.getByTitle('Add AAPL to watchlist').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTitle('Add MSFT to watchlist').first()).toBeVisible({ timeout: 5_000 });
  });

  test('clicking a screener result link navigates to its stock page', async ({ page }) => {
    // Auth mocks are required — /stocks/AAPL is a protected route. Without them the real
    // portfolio-api validates the mock JWT, returns 401, and the Axios interceptor redirects
    // to /login instead of the stock page.
    await setupAuthSession(page);
    await setupHomeFullMocks(page);
    // Minimal mocks for the AAPL stock page so navigation succeeds.
    await page.route(/\/api\/stocks\/AAPL$/, (route) =>
      fulfill(route, { symbol: 'AAPL', price: 180.5, change: 3.7, changePercent: 2.1 }),
    );
    await page.route(/\/api\/stocks\/AAPL\/history/, (route) => fulfill(route, []));
    await page.route(/\/api\/signals\/AAPL$/, (route) =>
      fulfill(route, { symbol: 'AAPL', sentiment: null, prediction: null }),
    );
    await page.route(/\/api\/predict\/AAPL$/, (route) =>
      fulfill(route, { symbol: 'AAPL', predictions: [] }),
    );
    await page.route(/\/api\/news\/AAPL$/, (route) => fulfill(route, []));
    await page.route(/\/api\/stocks\/AAPL\/analyst$/, (route) =>
      fulfill(route, {
        strongBuy: 0,
        buy: 0,
        hold: 0,
        sell: 0,
        strongSell: 0,
        analystCount: 0,
        priceTarget: null,
        consensus: null,
        asOf: null,
      }),
    );

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Stock Screener' }).click();
    await page.waitForTimeout(400);

    // exact: true targets the screener ticker link, not the movers card link for AAPL
    // (which has accessible name "AAPL $180.00 +2.86%" including price text).
    await page.getByRole('link', { name: 'AAPL', exact: true }).click();
    await page.waitForURL(/\/stocks\/AAPL/, { timeout: 10_000 });

    await expect(page).toHaveURL(/\/stocks\/AAPL/);
  });
});
