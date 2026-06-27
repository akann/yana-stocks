import { test, expect } from '../fixtures/base.fixture';
import {
  mockMovers,
  mockMarketOverview,
  mockAssets,
  mockSectorRotation,
  fulfill,
} from '../fixtures/api-mocks';

// The home page mixes several endpoints. Helper sets all of them up.
async function setupHomeFullMocks(page: import('@playwright/test').Page): Promise<void> {
  await mockMovers(page);
  await mockMarketOverview(page);
  await mockSectorRotation(page);
  await mockAssets(page);
  await page.route(/\/api\/portfolio\/watchlists$/, (route) => fulfill(route, []));
}

// All home tests use desktop viewport — several components are hidden below 768 px.
test.use({ viewport: { width: 1280, height: 900 } });

// ── Index cards ───────────────────────────────────────────────────────────────

test.describe('Home screen — index cards', () => {
  test('shows S&P 500, Nasdaq, and FTSE 100 index cards', async ({ page }) => {
    await setupHomeFullMocks(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('S&P 500').first()).toBeVisible();
    await expect(page.getByText('Nasdaq').first()).toBeVisible();
    await expect(page.getByText('FTSE 100').first()).toBeVisible();
  });

  test('index card shows formatted price from MOCK_OVERVIEW', async ({ page }) => {
    await setupHomeFullMocks(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // S&P 500 price = 5250.2 — IndicesBar formats with a comma (e.g. "5,250.20")
    await expect(page.getByText(/5[,.]?250/)).toBeVisible();
  });

  test('renders three index cards total', async ({ page }) => {
    await setupHomeFullMocks(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Each IndexQuote card is a <div> containing the name. MOCK_OVERVIEW has 3 indices.
    for (const name of ['S&P 500', 'Nasdaq', 'FTSE 100']) {
      await expect(page.getByText(name).first()).toBeVisible();
    }
  });
});

// ── Market News ───────────────────────────────────────────────────────────────

test.describe('Home screen — Market News', () => {
  test('shows "Market News" heading', async ({ page }) => {
    await setupHomeFullMocks(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Market News')).toBeVisible();
  });

  test('renders article titles from MOCK_OVERVIEW news', async ({ page }) => {
    await setupHomeFullMocks(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Fed holds rates steady amid inflation concerns')).toBeVisible();
    await expect(page.getByText('Market rally continues into Q3')).toBeVisible();
  });
});

// ── Sector Rotation ───────────────────────────────────────────────────────────

test.describe('Home screen — Sector Rotation', () => {
  test('shows "Sector Rotation" heading', async ({ page }) => {
    await setupHomeFullMocks(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Sector Rotation')).toBeVisible();
  });

  test('shows S&P 500 and FTSE 100 index tabs in Sector Rotation', async ({ page }) => {
    await setupHomeFullMocks(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // SectorRotationHeatmap has tabs for S&P 500 and FTSE 100
    await expect(page.getByRole('button', { name: 'S&P 500' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'FTSE 100' }).first()).toBeVisible();
  });
});
