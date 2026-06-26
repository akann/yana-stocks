import { test, expect, setupStockMocks } from '../fixtures/base.fixture';
import { makeMinuteBars, makeDailyBarsWithDuplicates } from '../fixtures/chart-data';
import { StockPage } from '../pages/stock.page';

const SYMBOL = 'NVDA';

// All 7 time-range labels rendered by StockChart
const ALL_RANGES = ['1H', '1D', '1W', '1M', '3M', '6M', '1Y'] as const;

test.describe('StockChart — /stocks/NVDA', () => {
  test('chart canvas renders with positive dimensions', async ({ page }) => {
    await setupStockMocks(page);
    const stockPage = new StockPage(page);
    await stockPage.goto(SYMBOL);
    await stockPage.waitForLoad();

    const box = await stockPage.canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  });

  test('renders all 7 ranges without JS errors', async ({ page, jsErrors }) => {
    await setupStockMocks(page);
    const stockPage = new StockPage(page);
    await stockPage.goto(SYMBOL);
    await stockPage.waitForLoad();

    for (const label of ALL_RANGES) {
      await stockPage.clickRange(label);
      // Brief settle time for the data effect and chart render
      await page.waitForTimeout(300);
    }

    expect(jsErrors, `JS errors after cycling all ranges: ${jsErrors.join('; ')}`).toHaveLength(0);
  });

  test('handles duplicate timestamps without crashing (regression for MongoDB T00/T04 bug)', async ({
    page,
    jsErrors,
  }) => {
    // Override history factory to return duplicate-timestamp data for daily intervals
    await setupStockMocks(page, (limit, interval) => {
      if (interval === '1d') return makeDailyBarsWithDuplicates(limit);
      return makeMinuteBars(limit);
    });

    const stockPage = new StockPage(page);
    await stockPage.goto(SYMBOL);
    await stockPage.waitForLoad();

    // 6M and 1Y are the ranges that surfaced the original crash
    await stockPage.clickRange('6M');
    await page.waitForTimeout(400);
    await stockPage.clickRange('1Y');
    await page.waitForTimeout(400);

    expect(jsErrors, `Duplicate-timestamp crash: ${jsErrors.join('; ')}`).toHaveLength(0);
  });

  test('candlestick and line modes both render without errors', async ({ page, jsErrors }) => {
    await setupStockMocks(page);
    const stockPage = new StockPage(page);
    await stockPage.goto(SYMBOL);
    await stockPage.waitForLoad();

    // Switch to Line mode
    await page.getByRole('button', { name: 'Line', exact: true }).click();
    await page.waitForTimeout(300);
    expect(jsErrors).toHaveLength(0);

    // Switch back to Candlestick mode
    await page.getByRole('button', { name: 'Candle', exact: true }).click();
    await page.waitForTimeout(300);
    expect(jsErrors).toHaveLength(0);

    // Canvas must still be visible after toggling chart type
    await expect(stockPage.canvas).toBeVisible();
  });

  test.describe('RSI indicator', () => {
    test('RSI 14 toggle button is visible on the stock page', async ({ page }) => {
      await setupStockMocks(page);
      const stockPage = new StockPage(page);
      await stockPage.goto(SYMBOL);
      await stockPage.waitForLoad();

      await expect(page.getByRole('button', { name: 'RSI 14' })).toBeVisible();
    });

    test('clicking RSI 14 activates the button with purple background', async ({ page }) => {
      await setupStockMocks(page);
      const stockPage = new StockPage(page);
      await stockPage.goto(SYMBOL);
      await stockPage.waitForLoad();

      const rsiBtn = page.getByRole('button', { name: 'RSI 14' });
      await rsiBtn.click();

      // #8b5cf6 = rgb(139, 92, 246)
      await expect(rsiBtn).toHaveCSS('background-color', 'rgb(139, 92, 246)');
    });

    test('toggling RSI on then off causes no JS errors', async ({ page, jsErrors }) => {
      await setupStockMocks(page);
      const stockPage = new StockPage(page);
      await stockPage.goto(SYMBOL);
      await stockPage.waitForLoad();

      const rsiBtn = page.getByRole('button', { name: 'RSI 14' });
      await rsiBtn.click(); // enable
      await page.waitForTimeout(300);
      await rsiBtn.click(); // disable
      await page.waitForTimeout(300);

      expect(jsErrors, `JS errors toggling RSI: ${jsErrors.join('; ')}`).toHaveLength(0);
      await expect(stockPage.canvas).toBeVisible();
    });

    test('RSI stays active and chart survives a candlestick ↔ line switch', async ({
      page,
      jsErrors,
    }) => {
      await setupStockMocks(page);
      const stockPage = new StockPage(page);
      await stockPage.goto(SYMBOL);
      await stockPage.waitForLoad();

      await page.getByRole('button', { name: 'RSI 14' }).click();
      await page.waitForTimeout(200);

      await page.getByRole('button', { name: 'Line', exact: true }).click();
      await page.waitForTimeout(300);
      expect(jsErrors, `JS errors after RSI+Line switch: ${jsErrors.join('; ')}`).toHaveLength(0);

      await page.getByRole('button', { name: 'Candle', exact: true }).click();
      await page.waitForTimeout(300);
      expect(jsErrors, `JS errors after RSI+Candle switch: ${jsErrors.join('; ')}`).toHaveLength(0);

      // RSI button must still be active after chart type switch (state survives recreation)
      await expect(page.getByRole('button', { name: 'RSI 14' })).toHaveCSS(
        'background-color',
        'rgb(139, 92, 246)',
      );
      await expect(stockPage.canvas).toBeVisible();
    });

    test('RSI active on 1M range (21 bars) produces output without errors', async ({
      page,
      jsErrors,
    }) => {
      await setupStockMocks(page);
      const stockPage = new StockPage(page);
      await stockPage.goto(SYMBOL);
      await stockPage.waitForLoad();

      // 1M = 21 daily bars → RSI(14) produces 7 data points
      await stockPage.clickRange('1M');
      await page.waitForTimeout(300);
      await page.getByRole('button', { name: 'RSI 14' }).click();
      await page.waitForTimeout(300);

      expect(jsErrors, `JS errors with RSI on 1M: ${jsErrors.join('; ')}`).toHaveLength(0);
      await expect(stockPage.canvas).toBeVisible();
    });

    test('switching to 1Y with RSI active produces no JS errors', async ({ page, jsErrors }) => {
      await setupStockMocks(page);
      const stockPage = new StockPage(page);
      await stockPage.goto(SYMBOL);
      await stockPage.waitForLoad();

      await page.getByRole('button', { name: 'RSI 14' }).click();
      await page.waitForTimeout(200);

      await stockPage.clickRange('1Y'); // 252 bars → 238 RSI values
      await page.waitForTimeout(400);

      expect(jsErrors, `JS errors with RSI on 1Y: ${jsErrors.join('; ')}`).toHaveLength(0);
      await expect(stockPage.canvas).toBeVisible();
    });
  });

  test.describe('MACD indicator', () => {
    test('MACD toggle button is visible on the stock page', async ({ page }) => {
      await setupStockMocks(page);
      const stockPage = new StockPage(page);
      await stockPage.goto(SYMBOL);
      await stockPage.waitForLoad();

      await expect(page.getByRole('button', { name: 'MACD' })).toBeVisible();
    });

    test('clicking MACD activates the button with amber background', async ({ page }) => {
      await setupStockMocks(page);
      const stockPage = new StockPage(page);
      await stockPage.goto(SYMBOL);
      await stockPage.waitForLoad();

      const macdBtn = page.getByRole('button', { name: 'MACD' });
      await macdBtn.click();

      // #f59e0b = rgb(245, 158, 11)
      await expect(macdBtn).toHaveCSS('background-color', 'rgb(245, 158, 11)');
    });

    test('toggling MACD on then off causes no JS errors', async ({ page, jsErrors }) => {
      await setupStockMocks(page);
      const stockPage = new StockPage(page);
      await stockPage.goto(SYMBOL);
      await stockPage.waitForLoad();

      const macdBtn = page.getByRole('button', { name: 'MACD' });
      await macdBtn.click();
      await page.waitForTimeout(300);
      await macdBtn.click();
      await page.waitForTimeout(300);

      expect(jsErrors, `JS errors toggling MACD: ${jsErrors.join('; ')}`).toHaveLength(0);
      await expect(stockPage.canvas).toBeVisible();
    });

    test('RSI and MACD both active causes no JS errors', async ({ page, jsErrors }) => {
      await setupStockMocks(page);
      const stockPage = new StockPage(page);
      await stockPage.goto(SYMBOL);
      await stockPage.waitForLoad();

      await page.getByRole('button', { name: 'RSI 14' }).click();
      await page.waitForTimeout(200);
      await page.getByRole('button', { name: 'MACD' }).click();
      await page.waitForTimeout(300);

      expect(jsErrors, `JS errors with RSI+MACD: ${jsErrors.join('; ')}`).toHaveLength(0);
      await expect(stockPage.canvas).toBeVisible();
    });

    test('MACD survives a candlestick ↔ line switch', async ({ page, jsErrors }) => {
      await setupStockMocks(page);
      const stockPage = new StockPage(page);
      await stockPage.goto(SYMBOL);
      await stockPage.waitForLoad();

      await page.getByRole('button', { name: 'MACD' }).click();
      await page.waitForTimeout(200);

      await page.getByRole('button', { name: 'Line', exact: true }).click();
      await page.waitForTimeout(300);
      expect(jsErrors, `JS errors after MACD+Line switch: ${jsErrors.join('; ')}`).toHaveLength(0);

      await page.getByRole('button', { name: 'Candle', exact: true }).click();
      await page.waitForTimeout(300);
      expect(jsErrors, `JS errors after MACD+Candle switch: ${jsErrors.join('; ')}`).toHaveLength(
        0,
      );

      await expect(page.getByRole('button', { name: 'MACD' })).toHaveCSS(
        'background-color',
        'rgb(245, 158, 11)',
      );
      await expect(stockPage.canvas).toBeVisible();
    });
  });

  test('chart stays populated after toggling chart type (regression: data effect must re-run on chartType change)', async ({
    page,
    jsErrors,
  }) => {
    await setupStockMocks(page);
    const stockPage = new StockPage(page);
    await stockPage.goto(SYMBOL);
    await stockPage.waitForLoad();

    // Verify chart has data on initial load (1W candlestick is the default)
    expect(await stockPage.hasChartContent()).toBe(true);

    // Switch to 1Y so there are plenty of bars to render
    await stockPage.clickRange('1Y');
    await page.waitForTimeout(300);
    expect(await stockPage.hasChartContent()).toBe(true);

    // Toggle to Line — this is where the bug caused a blank chart
    await page.getByRole('button', { name: 'Line', exact: true }).click();
    await page.waitForTimeout(300);
    expect(
      await stockPage.hasChartContent(),
      'chart must not go blank when switching to Line on 1Y',
    ).toBe(true);

    // Toggle back to Candlestick
    await page.getByRole('button', { name: 'Candle', exact: true }).click();
    await page.waitForTimeout(300);
    expect(
      await stockPage.hasChartContent(),
      'chart must not go blank when switching back to Candlestick on 1Y',
    ).toBe(true);

    expect(jsErrors).toHaveLength(0);
  });
});
