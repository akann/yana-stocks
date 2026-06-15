/**
 * Stocks tests: home page search, stock detail page, market movers, signals & predictions.
 *
 * Stock/signals pages do not require authentication — the API mocks always return data.
 */
import { test, expect } from '@playwright/test';
import { HomePage } from '../pages/HomePage';
import { StockPage } from '../pages/StockPage';
import {
  MOCK_STOCK_AAPL,
  MOCK_SIGNALS_AAPL,
  MOCK_PREDICTIONS_AAPL,
  MOCK_MARKET_MOVERS,
  MOCK_ASSETS_PAGE,
} from '../fixtures/data';

function stubStockPage(page: import('@playwright/test').Page, symbol = 'AAPL') {
  void page.route(`**/api/stocks/${symbol}`, (r) => r.fulfill({ json: MOCK_STOCK_AAPL }));
  void page.route(`**/api/stocks/${symbol}/history**`, (r) => r.fulfill({ json: [] }));
  void page.route(`**/api/signals/${symbol}`, (r) => r.fulfill({ json: MOCK_SIGNALS_AAPL }));
  void page.route(`**/api/predict/${symbol}`, (r) => r.fulfill({ json: MOCK_PREDICTIONS_AAPL }));
  void page.route(`**/api/news/${symbol}`, (r) => r.fulfill({ json: [] }));
}

function stubHomePage(page: import('@playwright/test').Page) {
  void page.route('**/api/market/movers', (r) => r.fulfill({ json: MOCK_MARKET_MOVERS }));
  void page.route('**/api/market/assets**', (r) => r.fulfill({ json: MOCK_ASSETS_PAGE }));
}

test.describe('Home page', () => {
  test('renders market overview with search bar', async ({ page }) => {
    stubHomePage(page);
    const home = new HomePage(page);
    await home.goto();
    await expect(page.getByRole('heading', { name: 'Stock Market Dashboard' })).toBeVisible();
    await expect(home.symbolInput).toBeVisible();
    await expect(home.searchButton).toBeVisible();
  });

  test('displays Top Gainers and Top Losers', async ({ page }) => {
    stubHomePage(page);
    const home = new HomePage(page);
    await home.goto();
    await expect(home.topGainersHeading).toBeVisible();
    await expect(home.topLosersHeading).toBeVisible();
  });

  test('gainers list shows NVDA from mocked data', async ({ page }) => {
    stubHomePage(page);
    const home = new HomePage(page);
    await home.goto();
    await expect(page.getByRole('link', { name: /NVDA/ })).toBeVisible();
  });

  test('losers list shows META from mocked data', async ({ page }) => {
    stubHomePage(page);
    const home = new HomePage(page);
    await home.goto();
    await expect(page.getByRole('link', { name: /META/ })).toBeVisible();
  });

  test('stock browser shows AAPL from mocked assets', async ({ page }) => {
    stubHomePage(page);
    const home = new HomePage(page);
    await home.goto();
    await expect(page.getByRole('cell', { name: 'AAPL' })).toBeVisible();
  });

  test('symbol search navigates to stock page', async ({ page }) => {
    stubHomePage(page);
    stubStockPage(page, 'AAPL');
    const home = new HomePage(page);
    await home.goto();
    await home.searchSymbol('AAPL');
    await page.waitForURL('/stocks/AAPL');
    await expect(page).toHaveURL('/stocks/AAPL');
  });

  test('symbol search uppercases the input', async ({ page }) => {
    stubHomePage(page);
    stubStockPage(page, 'MSFT');
    await page.route('**/api/stocks/MSFT', (r) => r.fulfill({ json: { ...MOCK_STOCK_AAPL, symbol: 'MSFT' } }));
    const home = new HomePage(page);
    await home.goto();
    await home.searchSymbol('msft');
    await page.waitForURL('/stocks/MSFT');
    await expect(page).toHaveURL('/stocks/MSFT');
  });
});

test.describe('Stock detail page', () => {
  test('shows symbol heading', async ({ page }) => {
    stubStockPage(page);
    const stock = new StockPage(page);
    await stock.goto('AAPL');
    await expect(stock.symbolHeading('AAPL')).toBeVisible();
  });

  test('shows live price', async ({ page }) => {
    stubStockPage(page);
    const stock = new StockPage(page);
    await stock.goto('AAPL');
    await expect(page.getByText('$185.50')).toBeVisible();
  });

  test('shows price change with positive color', async ({ page }) => {
    stubStockPage(page);
    const stock = new StockPage(page);
    await stock.goto('AAPL');
    // Change is +2.30 (1.26%)
    await expect(page.getByText(/\+2\.30/)).toBeVisible();
  });

  test('shows live indicator', async ({ page }) => {
    stubStockPage(page);
    const stock = new StockPage(page);
    await stock.goto('AAPL');
    await expect(page.getByText('Live')).toBeVisible();
  });

  test('shows sentiment section', async ({ page }) => {
    stubStockPage(page);
    const stock = new StockPage(page);
    await stock.goto('AAPL');
    await expect(stock.sentimentSection()).toBeVisible();
  });

  test('shows positive sentiment label from mocked signal', async ({ page }) => {
    stubStockPage(page);
    const stock = new StockPage(page);
    await stock.goto('AAPL');
    await expect(stock.sentimentLabel('positive')).toBeVisible();
  });

  test('shows sentiment headline from mocked signal', async ({ page }) => {
    stubStockPage(page);
    const stock = new StockPage(page);
    await stock.goto('AAPL');
    await expect(stock.sentimentHeadline('Apple reports record Q4 earnings')).toBeVisible();
  });

  test('shows predictions section', async ({ page }) => {
    stubStockPage(page);
    const stock = new StockPage(page);
    await stock.goto('AAPL');
    await expect(stock.predictionsSection()).toBeVisible();
  });

  test('shows predicted price from mocked prediction', async ({ page }) => {
    stubStockPage(page);
    const stock = new StockPage(page);
    await stock.goto('AAPL');
    // MOCK_PREDICTIONS_AAPL.predictions[0].predictedPrice = 190.0
    await expect(stock.predictionPrice('$190.00')).toBeVisible();
  });

  test('shows confidence from mocked prediction', async ({ page }) => {
    stubStockPage(page);
    const stock = new StockPage(page);
    await stock.goto('AAPL');
    // confidence 0.81 → "81%"
    await expect(page.getByText('conf: 81%')).toBeVisible();
  });

  test('shows Recent News section', async ({ page }) => {
    stubStockPage(page);
    const stock = new StockPage(page);
    await stock.goto('AAPL');
    await expect(stock.recentNewsSection()).toBeVisible();
  });

  test('shows no news message when articles array is empty', async ({ page }) => {
    stubStockPage(page);
    const stock = new StockPage(page);
    await stock.goto('AAPL');
    await expect(page.getByText('No news available')).toBeVisible();
  });

  test('clicking NVDA in movers navigates to NVDA stock page', async ({ page }) => {
    stubHomePage(page);
    await page.route('**/api/stocks/NVDA', (r) =>
      r.fulfill({ json: { ...MOCK_STOCK_AAPL, symbol: 'NVDA', price: 620.0 } }),
    );
    await page.route('**/api/stocks/NVDA/history**', (r) => r.fulfill({ json: [] }));
    await page.route('**/api/signals/NVDA', (r) =>
      r.fulfill({ json: { symbol: 'NVDA', sentiment: null, prediction: null } }),
    );
    await page.route('**/api/predict/NVDA', (r) =>
      r.fulfill({ json: { symbol: 'NVDA', predictions: [] } }),
    );
    await page.route('**/api/news/NVDA', (r) => r.fulfill({ json: [] }));

    const home = new HomePage(page);
    await home.goto();
    await page.getByRole('link', { name: /NVDA/ }).first().click();
    await page.waitForURL('/stocks/NVDA');
    await expect(page).toHaveURL('/stocks/NVDA');
  });
});
