import type { Page } from '@playwright/test';
import { test, expect, setupStockMocks } from '../fixtures/base.fixture';
import {
  setupAuthSession,
  mockWatchlistsEndpoint,
  mockPortfoliosEndpoint,
  mockAssets,
} from '../fixtures/api-mocks';

// The two SymbolSearch instances share a placeholder; the desktop one is
// display:none below md, so scope queries to the visible instance.
const visibleSearch = (page: Page) => page.locator('input[placeholder="Search symbol…"]:visible');

test.describe('Navbar — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await setupAuthSession(page);
    await mockWatchlistsEndpoint(page, []);
    await page.goto('/watchlist');
    await page.waitForLoadState('networkidle');
  });

  test('shows the hamburger and hides the inline nav links', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
    // Inline links are display:none below md, so they are absent from the a11y tree
    await expect(page.getByRole('link', { name: 'Portfolio' })).toHaveCount(0);
    await expect(visibleSearch(page)).toHaveCount(0);
  });

  test('hamburger opens a panel with search and all nav links', async ({ page }) => {
    await page.getByRole('button', { name: 'Open menu' }).click();

    await expect(visibleSearch(page)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Market' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Portfolio' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Watchlist' })).toBeVisible();
    // Toggle button flips to a close affordance
    await expect(page.getByRole('button', { name: 'Close menu' })).toBeVisible();
  });

  test('tapping a nav link navigates and closes the panel', async ({ page }) => {
    await mockPortfoliosEndpoint(page, []);

    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('link', { name: 'Portfolio' }).click();

    await page.waitForURL(/\/portfolio/, { timeout: 10_000 });
    await expect(visibleSearch(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
  });

  test('mobile symbol search navigates to the stock page and closes the panel', async ({
    page,
  }) => {
    await mockAssets(page);
    await setupStockMocks(page); // NVDA stock-page mocks

    await page.getByRole('button', { name: 'Open menu' }).click();
    await visibleSearch(page).fill('NVDA');
    await page.getByRole('button', { name: 'NVDA NVIDIA Corporation' }).click();

    await page.waitForURL(/\/stocks\/NVDA/, { timeout: 10_000 });
    await expect(visibleSearch(page)).toHaveCount(0);
  });
});

test.describe('Navbar — desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeEach(async ({ page }) => {
    await setupAuthSession(page);
    await mockWatchlistsEndpoint(page, []);
    await page.goto('/watchlist');
    await page.waitForLoadState('networkidle');
  });

  test('hides the hamburger and shows inline nav links and search', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Open menu' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Portfolio' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(visibleSearch(page)).toBeVisible();
  });
});
