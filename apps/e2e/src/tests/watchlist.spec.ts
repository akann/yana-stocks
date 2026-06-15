/**
 * Watchlist tests: create, add symbol, remove symbol, delete, empty state.
 *
 * All tests use the `authedPage` fixture (tokens pre-set in localStorage) and
 * mock the portfolio + stocks API.
 */
import { test, expect } from '../fixtures/auth.fixture';
import { WatchlistPage } from '../pages/WatchlistPage';
import { makeWatchlist, MOCK_STOCK_AAPL } from '../fixtures/data';

test.describe('Watchlist page', () => {
  test('shows empty state when user has no watchlists', async ({ authedPage: page }) => {
    await page.route('**/api/portfolio/watchlists', (r) => r.fulfill({ json: [] }));

    const wl = new WatchlistPage(page);
    await wl.goto();
    await expect(wl.heading).toBeVisible();
    await expect(wl.emptyState).toBeVisible();
    await expect(wl.newWatchlistButton).toBeVisible();
  });

  test('create watchlist — appears in list', async ({ authedPage: page }) => {
    const watchlists: ReturnType<typeof makeWatchlist>[] = [];

    await page.route('**/api/portfolio/watchlists', async (r) => {
      if (r.request().method() === 'GET') {
        await r.fulfill({ json: watchlists });
      } else {
        const body = r.request().postDataJSON() as { name: string };
        const created = makeWatchlist(body.name);
        watchlists.push(created);
        await r.fulfill({ status: 201, json: created });
      }
    });

    const wl = new WatchlistPage(page);
    await wl.goto();
    await expect(wl.emptyState).toBeVisible();

    await wl.newWatchlistButton.click();
    await wl.watchlistNameInput.fill('AI Stocks');
    await wl.createButton.click();

    await expect(wl.watchlistHeading('AI Stocks')).toBeVisible();
    await expect(wl.emptyState).not.toBeVisible();
  });

  test('add symbol to watchlist — row appears in table', async ({ authedPage: page }) => {
    const w = makeWatchlist('My Watch');
    const watchlists = [w];

    await page.route('**/api/portfolio/watchlists', async (r) => {
      if (r.request().method() === 'GET') {
        await r.fulfill({ json: watchlists });
      } else {
        await r.fulfill({ status: 201, json: w });
      }
    });

    await page.route('**/api/portfolio/watchlists/*/symbols', async (r) => {
      if (r.request().method() === 'POST') {
        const body = r.request().postDataJSON() as { symbol: string };
        w.symbols.push(body.symbol);
        await r.fulfill({ status: 200, json: w });
      }
    });

    await page.route('**/api/stocks/AAPL', (r) => r.fulfill({ json: MOCK_STOCK_AAPL }));

    const wl = new WatchlistPage(page);
    await wl.goto();
    await expect(wl.watchlistHeading('My Watch')).toBeVisible();

    await wl.addSymbolButton().click();
    await wl.symbolInput().fill('AAPL');
    await wl.addSubmitButton().click();

    await expect(wl.symbolCell('AAPL')).toBeVisible();
  });

  test('remove symbol from watchlist', async ({ authedPage: page }) => {
    const w = { ...makeWatchlist('Tech Watch'), symbols: ['AAPL'] };
    const watchlists = [w];

    await page.route('**/api/portfolio/watchlists', async (r) => {
      await r.fulfill({ json: watchlists });
    });

    await page.route('**/api/portfolio/watchlists/*/symbols/*', async (r) => {
      if (r.request().method() === 'DELETE') {
        w.symbols = [];
        await r.fulfill({ status: 204 });
      }
    });

    await page.route('**/api/stocks/AAPL', (r) => r.fulfill({ json: MOCK_STOCK_AAPL }));

    const wl = new WatchlistPage(page);
    await wl.goto();
    await expect(wl.symbolCell('AAPL')).toBeVisible();

    await wl.removeSymbolButton('AAPL').click();
    await expect(wl.symbolCell('AAPL')).not.toBeVisible();
    await expect(page.getByText('No symbols yet — add one below.')).toBeVisible();
  });

  test('delete watchlist with confirmation', async ({ authedPage: page }) => {
    const w = makeWatchlist('Delete Me');
    const watchlists = [w];

    await page.route('**/api/portfolio/watchlists', async (r) => {
      if (r.request().method() === 'GET') {
        await r.fulfill({ json: watchlists });
      } else {
        await r.fulfill({ status: 201, json: w });
      }
    });

    await page.route('**/api/portfolio/watchlists/*', async (r) => {
      if (r.request().method() === 'DELETE') {
        watchlists.splice(0, 1);
        await r.fulfill({ status: 204 });
      }
    });

    const wl = new WatchlistPage(page);
    await wl.goto();
    await expect(wl.watchlistHeading('Delete Me')).toBeVisible();

    await wl.deleteButton().click();
    await expect(page.getByText('Delete?')).toBeVisible();
    await wl.confirmDeleteButton().click();

    await expect(wl.emptyState).toBeVisible();
    await expect(wl.watchlistHeading('Delete Me')).not.toBeVisible();
  });

  test('cancel delete keeps watchlist visible', async ({ authedPage: page }) => {
    const w = makeWatchlist('Keep This');
    await page.route('**/api/portfolio/watchlists', (r) => r.fulfill({ json: [w] }));

    const wl = new WatchlistPage(page);
    await wl.goto();
    await expect(wl.watchlistHeading('Keep This')).toBeVisible();

    await wl.deleteButton().click();
    await expect(page.getByText('Delete?')).toBeVisible();
    await page.getByRole('button', { name: 'No' }).click();
    await expect(wl.watchlistHeading('Keep This')).toBeVisible();
  });

  test('clicking a symbol navigates to stock page', async ({ authedPage: page }) => {
    const w = { ...makeWatchlist('Click Test'), symbols: ['AAPL'] };
    await page.route('**/api/portfolio/watchlists', (r) => r.fulfill({ json: [w] }));
    await page.route('**/api/stocks/AAPL', (r) => r.fulfill({ json: MOCK_STOCK_AAPL }));
    // Stub all stock page requests
    await page.route('**/api/stocks/AAPL/history**', (r) => r.fulfill({ json: [] }));
    await page.route('**/api/signals/AAPL', (r) => r.fulfill({ json: { symbol: 'AAPL', sentiment: null, prediction: null } }));
    await page.route('**/api/predict/AAPL', (r) => r.fulfill({ json: { symbol: 'AAPL', predictions: [] } }));
    await page.route('**/api/news/AAPL', (r) => r.fulfill({ json: [] }));

    const wl = new WatchlistPage(page);
    await wl.goto();
    await expect(wl.symbolCell('AAPL')).toBeVisible();

    await wl.symbolCell('AAPL').click();
    await page.waitForURL('/stocks/AAPL');
    await expect(page).toHaveURL('/stocks/AAPL');
  });
});
