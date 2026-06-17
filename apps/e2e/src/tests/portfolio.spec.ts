/**
 * Portfolio tests: create, add stock, delete, empty state, navigation to stock page.
 *
 * All tests use the `authedPage` fixture (tokens pre-set in localStorage) and
 * mock the portfolio + stocks API.
 */
import { test, expect } from '../fixtures/auth.fixture';
import { PortfolioPage } from '../pages/PortfolioPage';
import { makePortfolio, makePortfolioWithStock, MOCK_STOCK_AAPL } from '../fixtures/data';

test.describe('Portfolio page', () => {
  test('shows empty state when user has no portfolios', async ({ authedPage: page }) => {
    await page.route('**/api/portfolio/portfolios', (r) => r.fulfill({ json: [] }));

    const portfolio = new PortfolioPage(page);
    await portfolio.goto();
    await expect(portfolio.heading).toBeVisible();
    await expect(portfolio.emptyState).toBeVisible();
    await expect(portfolio.newPortfolioButton).toBeVisible();
  });

  test('create portfolio — appears in list', async ({ authedPage: page }) => {
    const portfolios: ReturnType<typeof makePortfolio>[] = [];

    await page.route('**/api/portfolio/portfolios', async (r) => {
      if (r.request().method() === 'GET') {
        await r.fulfill({ json: portfolios });
      } else {
        const body = r.request().postDataJSON() as { name: string };
        const created = makePortfolio(body.name);
        portfolios.push(created);
        await r.fulfill({ status: 201, json: created });
      }
    });

    const portfolio = new PortfolioPage(page);
    await portfolio.goto();
    await expect(portfolio.emptyState).toBeVisible();

    await portfolio.newPortfolioButton.click();
    await portfolio.portfolioNameInput.fill('My Tech Portfolio');
    await portfolio.createButton.click();

    await expect(portfolio.portfolioHeading('My Tech Portfolio')).toBeVisible();
    await expect(portfolio.emptyState).not.toBeVisible();
  });

  test('add stock to portfolio — stock row appears in table', async ({ authedPage: page }) => {
    const p = makePortfolio('Growth Fund');
    const portfolios = [p];

    await page.route('**/api/portfolio/portfolios', async (r) => {
      if (r.request().method() === 'GET') {
        await r.fulfill({ json: portfolios });
      } else {
        await r.fulfill({ status: 201, json: p });
      }
    });

    await page.route('**/api/portfolio/portfolios/*/stocks', async (r) => {
      const body = r.request().postDataJSON() as {
        symbol: string;
        shares: number;
        price: number;
      };
      p.stocks.push({ symbol: body.symbol, shares: body.shares, avgCostBasis: body.price });
      await r.fulfill({ status: 201, json: p });
    });

    // Mock live price fetch triggered after stock is added
    await page.route('**/api/stocks/AAPL', (r) => r.fulfill({ json: MOCK_STOCK_AAPL }));

    const portfolio = new PortfolioPage(page);
    await portfolio.goto();
    await expect(portfolio.portfolioHeading('Growth Fund')).toBeVisible();

    await portfolio.addStockLink().click();

    // Wait for AddStockModal
    await expect(page.getByRole('heading', { name: 'Add Stock' })).toBeVisible();
    await portfolio.stockSymbolInput().fill('AAPL');
    await portfolio.stockSharesInput().fill('10');
    await portfolio.stockPriceInput().fill('175.00');
    await portfolio.addStockSubmitButton().click();

    await expect(portfolio.stockRow('AAPL')).toBeVisible();
  });

  test('delete portfolio with confirmation', async ({ authedPage: page }) => {
    const p = makePortfolio('To Delete');
    const portfolios = [p];

    await page.route('**/api/portfolio/portfolios', async (r) => {
      if (r.request().method() === 'GET') {
        await r.fulfill({ json: portfolios });
      } else {
        await r.fulfill({ status: 201, json: p });
      }
    });

    await page.route('**/api/portfolio/portfolios/*', async (r) => {
      if (r.request().method() === 'DELETE') {
        portfolios.splice(0, 1);
        await r.fulfill({ status: 204 });
      } else {
        await r.fulfill({ json: portfolios });
      }
    });

    const portfolio = new PortfolioPage(page);
    await portfolio.goto();
    await expect(portfolio.portfolioHeading('To Delete')).toBeVisible();

    await portfolio.deleteButton().click();
    await expect(page.getByText('Delete portfolio?')).toBeVisible();
    await portfolio.confirmDeleteButton().click();

    await expect(portfolio.emptyState).toBeVisible();
    await expect(portfolio.portfolioHeading('To Delete')).not.toBeVisible();
  });

  test('cancel delete keeps portfolio visible', async ({ authedPage: page }) => {
    const p = makePortfolio('Keep Me');
    await page.route('**/api/portfolio/portfolios', (r) => r.fulfill({ json: [p] }));

    const portfolio = new PortfolioPage(page);
    await portfolio.goto();
    await expect(portfolio.portfolioHeading('Keep Me')).toBeVisible();

    await portfolio.deleteButton().click();
    await expect(page.getByText('Delete portfolio?')).toBeVisible();
    await page.getByRole('button', { name: 'No' }).click();
    await expect(portfolio.portfolioHeading('Keep Me')).toBeVisible();
  });

  test('clicking a holding row navigates to stock page', async ({ authedPage: page }) => {
    const p = makePortfolioWithStock('Nav Test');
    await page.route('**/api/portfolio/portfolios', (r) => r.fulfill({ json: [p] }));
    await page.route('**/api/stocks/AAPL', (r) => r.fulfill({ json: MOCK_STOCK_AAPL }));
    // Stub stock page API calls
    await page.route('**/api/stocks/AAPL/history**', (r) => r.fulfill({ json: [] }));
    await page.route('**/api/signals/AAPL', (r) =>
      r.fulfill({ json: { symbol: 'AAPL', sentiment: null, prediction: null } }),
    );
    await page.route('**/api/predict/AAPL', (r) =>
      r.fulfill({ json: { symbol: 'AAPL', predictions: [] } }),
    );
    await page.route('**/api/news/AAPL', (r) => r.fulfill({ json: [] }));

    const portfolio = new PortfolioPage(page);
    await portfolio.goto();
    await expect(portfolio.stockRow('AAPL')).toBeVisible();

    await portfolio.stockRow('AAPL').click();
    await page.waitForURL('/stocks/AAPL');
    await expect(page).toHaveURL('/stocks/AAPL');
  });

  test('shows portfolio summary card when holdings exist', async ({ authedPage: page }) => {
    const p = makePortfolioWithStock('Tech Fund');
    await page.route('**/api/portfolio/portfolios', (r) => r.fulfill({ json: [p] }));
    await page.route('**/api/stocks/AAPL', (r) => r.fulfill({ json: MOCK_STOCK_AAPL }));

    const portfolio = new PortfolioPage(page);
    await portfolio.goto();
    await expect(page.getByText('Overall Summary')).toBeVisible();
    await expect(page.getByText('Market Value')).toBeVisible();
  });
});
