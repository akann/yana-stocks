import { test, expect, setupStockMocks } from '../fixtures/base.fixture';
import {
  fulfill,
  mockMovers,
  mockAssets,
  mockMarketOverview,
  mockSectorRotation,
  setupAuthSession,
  MOCK_UK_ASSETS_PAGE,
} from '../fixtures/api-mocks';

// SymbolSearch is in the Navbar with `hidden md:block` — only visible at ≥768 px width.
// These tests use a desktop viewport so the component is rendered and interactive.
test.describe('Market dashboard — Navbar SymbolSearch (desktop only)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('Navbar symbol search input is visible on the home page', async ({ page }) => {
    await mockMovers(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.getByPlaceholder('Search symbol…')).toBeVisible();
  });

  test('Navbar symbol search uppercases and navigates to /stocks/:SYMBOL on Enter', async ({
    page,
  }) => {
    await mockMovers(page);
    await setupStockMocks(page); // auth + NVDA stock page mocks

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // SymbolSearch: pressing Enter with no dropdown selection navigates to
    // query.trim().toUpperCase() — no need to wait for the autocomplete dropdown.
    // pressSequentially, not fill() — see the note on the equivalent MarketBrowser
    // search test below for why fill() is unreliable for this app's controlled
    // inputs on the mobile-safari (WebKit) project.
    const input = page.getByPlaceholder('Search symbol…');
    await input.click();
    await input.pressSequentially('nvda');
    await input.press('Enter');
    await page.waitForURL(/\/stocks\/NVDA/, { timeout: 10_000 });

    await expect(page).toHaveURL(/\/stocks\/NVDA/);
  });
});

test.describe('Market dashboard (homepage)', () => {
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
    // SectorRotationHeatmap is on the homepage — give it data so it renders the
    // treemap instead of its own "No data" placeholder, which would skew the count.
    await mockSectorRotation(page);
    await mockMarketOverview(page);
    await page.goto('/');

    const noDataNodes = page.getByText('No data');
    await expect(noDataNodes.first()).toBeVisible();
    await expect(noDataNodes).toHaveCount(2);
  });
});

test.describe('MarketBrowser', () => {
  async function setup(page: Parameters<typeof mockMovers>[0]): Promise<void> {
    await mockMovers(page);
    await mockAssets(page);
    // AddToWatchlistButton fetches watchlists; return empty list to avoid unrouted requests.
    await page.route(/\/api\/portfolio\/watchlists$/, (route) => fulfill(route, []));
  }

  test('renders US Equities tab by default with US symbols', async ({ page }) => {
    await setup(page);
    await page.goto('/');

    await expect(page.getByRole('button', { name: '🇺🇸 US Equities' })).toBeVisible();
    // AAPL also appears in the movers section, so use exact name (just the ticker) to
    // target only the MarketBrowser row link.
    await expect(page.getByRole('link', { name: 'AAPL', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'MSFT', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'NVDA', exact: true })).toBeVisible();
  });

  test('clicking UK tab shows .L symbols', async ({ page }) => {
    await setup(page);
    await page.goto('/');

    await page.getByRole('button', { name: '🇬🇧 UK Equities' }).click();

    await expect(page.getByRole('link', { name: 'HSBA.L' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'BARC.L' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'BP.L' })).toBeVisible();
  });

  test('clicking a UK stock link navigates to /stocks/HSBA.L preserving .L suffix', async ({
    page,
  }) => {
    await setup(page);
    // /stocks/HSBA.L is a protected route (proxy.ts) — needs a session cookie
    // or the navigation bounces to /login instead.
    await setupAuthSession(page);
    // Mock the UK stock page endpoints so navigation succeeds.
    await page.route(/\/api\/stocks\/HSBA\.L$/, (route) =>
      fulfill(route, { symbol: 'HSBA.L', price: 640.5, change: 2.3, changePercent: 0.36 }),
    );
    await page.route(/\/api\/stocks\/HSBA\.L\/history/, (route) => fulfill(route, []));
    await page.route(/\/api\/signals\/HSBA\.L$/, (route) =>
      fulfill(route, { symbol: 'HSBA.L', sentiment: null, prediction: null }),
    );
    await page.route(/\/api\/predict\/HSBA\.L$/, (route) =>
      fulfill(route, { symbol: 'HSBA.L', predictions: [] }),
    );
    await page.route(/\/api\/news\/HSBA\.L$/, (route) => fulfill(route, []));

    await page.goto('/');
    await page.getByRole('button', { name: '🇬🇧 UK Equities' }).click();
    await page.getByRole('link', { name: 'HSBA.L' }).click();

    await page.waitForURL(/\/stocks\/HSBA\.L/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/stocks\/HSBA\.L/);
  });

  test('clicking ETF tab shows ETF symbols', async ({ page }) => {
    await setup(page);
    await page.goto('/');

    await page.getByRole('button', { name: '📊 ETFs' }).click();

    await expect(page.getByRole('link', { name: 'SPY' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'QQQ' })).toBeVisible();
  });

  test('search with no match shows empty state message', async ({ page }) => {
    await setup(page);
    // Override to return empty results for any search query
    await page.route(/\/api\/market\/assets/, (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('search'))
        return fulfill(route, { data: [], total: 0, page: 1, limit: 20 });
      const market = url.searchParams.get('market') ?? 'us';
      const fixture =
        market === 'uk'
          ? MOCK_UK_ASSETS_PAGE
          : market === 'etf'
            ? { data: [], total: 0, page: 1, limit: 20 }
            : {
                data: [
                  {
                    symbol: 'AAPL',
                    name: 'Apple Inc.',
                    exchange: 'NASDAQ',
                    tradable: true,
                    assetClass: 'us_equity',
                  },
                ],
                total: 1,
                page: 1,
                limit: 20,
              };
      return fulfill(route, fixture);
    });
    await page.goto('/');

    // .fill() sets the DOM value directly and (on this input, only on the
    // mobile-safari/WebKit project) never dispatches a real `input` event —
    // confirmed by attaching a plain addEventListener('input', ...) directly
    // to the element: it never fires, so React's onChange (and therefore
    // setSearch) never runs and the box silently reverts to empty on the next
    // render. pressSequentially() simulates real keystrokes instead, which
    // WebKit reliably turns into native input events same as a real user
    // typing — this is a test/automation-layer gap, not an app bug, so the
    // fix belongs here rather than in MarketBrowser.tsx.
    const input = page.getByPlaceholder('Search symbol or name…');
    await input.click();
    await input.pressSequentially('ZZZZ');
    // TanStack Query's placeholderData keeps showing old results while the new fetch
    // is in flight. Wait for network to settle so React has committed the empty state.
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/No results for/)).toBeVisible();
  });
});
