import { test, expect, setupStockMocks } from '../fixtures/base.fixture';
import { MOCK_NEWS_ARTICLES, MOCK_ANALYST_RATING, fulfill } from '../fixtures/api-mocks';
import { StockPage } from '../pages/stock.page';
import { makeDecliningDailyBars } from '../fixtures/chart-data';

const SYMBOL = 'NVDA';

// ── Volume / OHLV header ──────────────────────────────────────────────────────

test.describe('Stock detail — OHLV header stats', () => {
  test('shows Open, High, Low, Volume labels', async ({ page }) => {
    await setupStockMocks(page);
    const stockPage = new StockPage(page);
    await stockPage.goto(SYMBOL);
    await stockPage.waitForLoad();

    // Labels are text-transformed uppercase via CSS but the DOM text is title-case.
    await expect(page.getByText('Open', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('High', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Low', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Volume', { exact: true }).first()).toBeVisible();
  });

  test('shows a formatted volume value (e.g. "50.0M")', async ({ page }) => {
    await setupStockMocks(page);
    const stockPage = new StockPage(page);
    await stockPage.goto(SYMBOL);
    await stockPage.waitForLoad();

    // makeDailyBars returns volume starting at 50_000_000 — formatVolume renders as "50.0M" or similar.
    // .first() avoids strict mode: "1M"/"3M"/"6M" time range buttons also match the regex.
    await expect(page.getByText(/\d+(\.\d+)?[MBK]/).first()).toBeVisible();
  });
});

// ── Recent News panel ─────────────────────────────────────────────────────────

test.describe('Stock detail — Recent News', () => {
  test('shows "Recent News" heading', async ({ page }) => {
    await setupStockMocks(page);
    const stockPage = new StockPage(page);
    await stockPage.goto(SYMBOL);
    await stockPage.waitForLoad();

    await expect(page.getByText('Recent News')).toBeVisible();
  });

  test('shows "No news available" when news endpoint returns empty array', async ({ page }) => {
    await setupStockMocks(page);
    // setupStockMocks already mocks /api/news/NVDA → []; this just confirms the empty state.
    const stockPage = new StockPage(page);
    await stockPage.goto(SYMBOL);
    await stockPage.waitForLoad();

    await expect(page.getByText('No news available')).toBeVisible();
  });

  test('renders article headlines when news endpoint returns data', async ({ page }) => {
    await setupStockMocks(page);
    await page.route(/\/api\/news\/NVDA$/, (route) => fulfill(route, MOCK_NEWS_ARTICLES));

    const stockPage = new StockPage(page);
    await stockPage.goto(SYMBOL);
    await stockPage.waitForLoad();

    await expect(page.getByText('NVIDIA Reports Record Revenue')).toBeVisible();
    await expect(page.getByText('AI Chip Demand Surges Ahead of Earnings')).toBeVisible();
  });

  test('shows sentiment label alongside each article', async ({ page }) => {
    await setupStockMocks(page);
    await page.route(/\/api\/news\/NVDA$/, (route) => fulfill(route, MOCK_NEWS_ARTICLES));

    const stockPage = new StockPage(page);
    await stockPage.goto(SYMBOL);
    await stockPage.waitForLoad();

    // Both mock articles have sentimentLabel: 'positive'
    const positiveLabels = page.getByText('positive');
    await expect(positiveLabels.first()).toBeVisible();
    await expect(positiveLabels).toHaveCount(2);
  });
});

// ── Analyst Ratings panel ─────────────────────────────────────────────────────

test.describe('Stock detail — Analyst Ratings', () => {
  test('shows "Analyst Ratings" heading', async ({ page }) => {
    await setupStockMocks(page);
    await page.route(/\/api\/stocks\/NVDA\/analyst$/, (route) =>
      fulfill(route, MOCK_ANALYST_RATING),
    );

    const stockPage = new StockPage(page);
    await stockPage.goto(SYMBOL);
    await stockPage.waitForLoad();

    await expect(page.getByText('Analyst Ratings')).toBeVisible();
  });

  test('shows Str Buy / Str Sell breakdown labels', async ({ page }) => {
    await setupStockMocks(page);
    await page.route(/\/api\/stocks\/NVDA\/analyst$/, (route) =>
      fulfill(route, MOCK_ANALYST_RATING),
    );

    const stockPage = new StockPage(page);
    await stockPage.goto(SYMBOL);
    await stockPage.waitForLoad();

    await expect(page.getByText('Str Buy')).toBeVisible();
    await expect(page.getByText('Str Sell')).toBeVisible();
  });

  test('shows price target from analyst data', async ({ page }) => {
    await setupStockMocks(page);
    await page.route(/\/api\/stocks\/NVDA\/analyst$/, (route) =>
      fulfill(route, MOCK_ANALYST_RATING),
    );

    const stockPage = new StockPage(page);
    await stockPage.goto(SYMBOL);
    await stockPage.waitForLoad();

    // MOCK_ANALYST_RATING.priceTarget = 650
    await expect(page.getByText(/\$650\.00/)).toBeVisible();
  });

  test('shows "Price target" label', async ({ page }) => {
    await setupStockMocks(page);
    await page.route(/\/api\/stocks\/NVDA\/analyst$/, (route) =>
      fulfill(route, MOCK_ANALYST_RATING),
    );

    const stockPage = new StockPage(page);
    await stockPage.goto(SYMBOL);
    await stockPage.waitForLoad();

    await expect(page.getByText('Price target')).toBeVisible();
  });
});

// ── Moving Average indicator toggles ─────────────────────────────────────────

const MA_BUTTONS = ['SMA 20', 'SMA 50', 'SMA 200', 'EMA 12', 'EMA 26'] as const;

test.describe('Stock detail — MA indicator toggles', () => {
  for (const label of MA_BUTTONS) {
    test(`${label} button is visible on the chart`, async ({ page }) => {
      await setupStockMocks(page);
      const stockPage = new StockPage(page);
      await stockPage.goto(SYMBOL);
      await stockPage.waitForLoad();

      // exact: true prevents 'SMA 20' from also matching 'SMA 200'.
      await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
    });
  }

  test('toggling SMA 20 on then off causes no JS errors', async ({ page, jsErrors }) => {
    await setupStockMocks(page);
    const stockPage = new StockPage(page);
    await stockPage.goto(SYMBOL);
    await stockPage.waitForLoad();

    const btn = page.getByRole('button', { name: 'SMA 20', exact: true });
    await btn.click();
    await page.waitForTimeout(300);
    await btn.click();
    await page.waitForTimeout(300);

    expect(jsErrors, `JS errors toggling SMA 20: ${jsErrors.join('; ')}`).toHaveLength(0);
    await expect(stockPage.canvas).toBeVisible();
  });

  test('all 5 MA overlays active simultaneously causes no JS errors', async ({
    page,
    jsErrors,
  }) => {
    await setupStockMocks(page);
    const stockPage = new StockPage(page);
    await stockPage.goto(SYMBOL);
    await stockPage.waitForLoad();

    for (const label of MA_BUTTONS) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(300);

    expect(jsErrors, `JS errors with all MAs active: ${jsErrors.join('; ')}`).toHaveLength(0);
    await expect(stockPage.canvas).toBeVisible();
  });

  test('MA + RSI + MACD all active causes no JS errors', async ({ page, jsErrors }) => {
    await setupStockMocks(page);
    const stockPage = new StockPage(page);
    await stockPage.goto(SYMBOL);
    await stockPage.waitForLoad();

    await page.getByRole('button', { name: 'SMA 20', exact: true }).click();
    await page.waitForTimeout(100);
    await page.getByRole('button', { name: 'RSI 14', exact: true }).click();
    await page.waitForTimeout(100);
    await page.getByRole('button', { name: 'MACD', exact: true }).click();
    await page.waitForTimeout(300);

    expect(jsErrors, `JS errors with SMA+RSI+MACD: ${jsErrors.join('; ')}`).toHaveLength(0);
    await expect(stockPage.canvas).toBeVisible();
  });

  test('MA stays active after candlestick ↔ line switch', async ({ page, jsErrors }) => {
    await setupStockMocks(page);
    const stockPage = new StockPage(page);
    await stockPage.goto(SYMBOL);
    await stockPage.waitForLoad();

    await page.getByRole('button', { name: 'EMA 26', exact: true }).click();
    await page.waitForTimeout(200);

    await page.getByRole('button', { name: 'Line', exact: true }).click();
    await page.waitForTimeout(300);
    expect(jsErrors, `JS errors after EMA26+Line: ${jsErrors.join('; ')}`).toHaveLength(0);

    await page.getByRole('button', { name: 'Candle', exact: true }).click();
    await page.waitForTimeout(300);
    expect(jsErrors, `JS errors after EMA26+Candle: ${jsErrors.join('; ')}`).toHaveLength(0);

    await expect(stockPage.canvas).toBeVisible();
  });
});

// ── RSI Oversold signal badge ─────────────────────────────────────────────────

test.describe('Stock detail — RSI signal badge', () => {
  test('shows "Oversold" badge when RSI active and all bars are declining (RSI ≈ 0)', async ({
    page,
    jsErrors,
  }) => {
    // Override history to return steadily declining bars — ensures RSI 14 < 30 on the last bar.
    await setupStockMocks(page, (limit, _interval) => makeDecliningDailyBars(Math.max(limit, 21)));

    const stockPage = new StockPage(page);
    await stockPage.goto(SYMBOL);
    await stockPage.waitForLoad();

    // Switch to 1M (21 daily bars) so RSI 14 has enough data
    await stockPage.clickRange('1M');
    await page.waitForTimeout(300);

    // Enable RSI — detectSignals() only emits RSI signals when showRSI=true
    await page.getByRole('button', { name: 'RSI 14', exact: true }).click();
    await page.waitForTimeout(400);

    // exact: true avoids strict mode: 'Oversold' is also a substring of the tooltip "RSI 0.0 — Oversold".
    await expect(page.getByText('Oversold', { exact: true })).toBeVisible({ timeout: 5_000 });
    expect(jsErrors).toHaveLength(0);
  });
});
