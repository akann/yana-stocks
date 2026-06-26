import { test, expect, setupStockMocks } from '../fixtures/base.fixture';
import { MOCK_MOVERS, fulfill, mockMovers } from '../fixtures/api-mocks';

test.describe('Market dashboard (homepage)', () => {
  test('shows heading, search input, and Go button', async ({ page }) => {
    await mockMovers(page);
    await page.goto('/');

    await expect(page.getByText('Stock Market Dashboard')).toBeVisible();
    await expect(page.getByPlaceholder('Search symbol (e.g. AAPL)')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Go' })).toBeVisible();
  });

  test('shows Top Gainers and Top Losers section headings', async ({ page }) => {
    await mockMovers(page);
    await page.goto('/');

    await expect(page.getByText('Top Gainers')).toBeVisible();
    await expect(page.getByText('Top Losers')).toBeVisible();
  });

  test('renders gainer and loser symbols from mocked data', async ({ page }) => {
    await mockMovers(page);
    await page.goto('/');

    for (const sym of ['NVDA', 'AAPL', 'TSLA']) {
      await expect(page.getByText(sym).first()).toBeVisible();
    }
  });

  test('renders formatted prices and change percentages', async ({ page }) => {
    await mockMovers(page);
    await page.goto('/');

    await expect(page.getByText('$194.92')).toBeVisible();
    await expect(page.getByText('+5.70%')).toBeVisible();
    await expect(page.getByText('-11.76%')).toBeVisible();
  });

  test('symbol search uppercases input and navigates to /stocks/:SYMBOL', async ({ page }) => {
    await mockMovers(page);
    await setupStockMocks(page); // NVDA stock page mocks

    await page.goto('/');
    await page.getByPlaceholder('Search symbol (e.g. AAPL)').fill('nvda');
    // press('Enter') on the focused input is more reliable than button click on
    // WebKit mobile simulation where synthetic mouse events can drop intermittently.
    await page.getByPlaceholder('Search symbol (e.g. AAPL)').press('Enter');
    await page.waitForURL(/\/stocks\/NVDA/, { timeout: 10_000 });

    await expect(page).toHaveURL(/\/stocks\/NVDA/);
  });

  test('pressing Enter in search box also navigates', async ({ page }) => {
    await mockMovers(page);
    await setupStockMocks(page);

    await page.goto('/');
    await page.getByPlaceholder('Search symbol (e.g. AAPL)').fill('NVDA');
    await page.getByPlaceholder('Search symbol (e.g. AAPL)').press('Enter');
    await page.waitForURL(/\/stocks\/NVDA/, { timeout: 10_000 });

    await expect(page).toHaveURL(/\/stocks\/NVDA/);
  });

  test('clicking a mover link navigates to its stock page', async ({ page }) => {
    await mockMovers(page);
    await setupStockMocks(page);

    await page.goto('/');
    await expect(page.getByText('NVDA').first()).toBeVisible();
    await page.getByRole('link').filter({ hasText: 'NVDA' }).first().click();
    await page.waitForURL(/\/stocks\/NVDA/, { timeout: 10_000 });

    await expect(page).toHaveURL(/\/stocks\/NVDA/);
  });

  test('shows "No data" placeholders when movers response is empty', async ({ page }) => {
    await page.route(/\/api\/market\/movers/, (route) =>
      fulfill(route, { gainers: [], losers: [] }),
    );
    await page.goto('/');

    const noDataNodes = page.getByText('No data');
    await expect(noDataNodes.first()).toBeVisible();
    await expect(noDataNodes).toHaveCount(2);
  });
});
