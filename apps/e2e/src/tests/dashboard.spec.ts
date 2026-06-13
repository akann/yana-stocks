import { test, expect } from '@playwright/test';
import { RegisterPage } from '../pages/auth.page';
import { DashboardPage } from '../pages/dashboard.page';
import { PortfolioPage } from '../pages/portfolio.page';

const PASSWORD = 'Test1234!';

test.describe('Dashboard', () => {
  let testEmail: string;
  let savedTokens: { at: string; rt: string } | null = null;

  test.beforeAll(async ({ browser }) => {
    testEmail = `e2e+dashboard+${Date.now()}@example.com`;
    const page = await browser.newPage();
    const registerPage = new RegisterPage(page);
    await registerPage.goto();
    await registerPage.register(testEmail, PASSWORD);
    await page.waitForURL('**/dashboard', { timeout: 30_000, waitUntil: 'commit' });
    savedTokens = await page.evaluate(() => ({
      at: localStorage.getItem('access_token') ?? '',
      rt: localStorage.getItem('refresh_token') ?? '',
    }));
    await page.close();
  });

  test.beforeEach(async ({ page }) => {
    // Inject tokens directly — avoids slow mobile-safari UI login on every test
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ at, rt }) => {
      localStorage.setItem('access_token', at);
      localStorage.setItem('refresh_token', rt);
    }, savedTokens!);
    await page.goto('/dashboard');
  });

  test('redirects unauthenticated user to login', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
    });
    // WebKit throws when a client-side redirect interrupts goto — swallow the error
    await page.goto('/dashboard').catch(() => {});
    await page.waitForURL('**/login', { timeout: 5_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test('shows Dashboard heading', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await expect(dashboard.heading).toBeVisible({ timeout: 5_000 });
  });

  test('shows three stat cards', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await expect(dashboard.totalValueCard).toBeVisible({ timeout: 5_000 });
    await expect(dashboard.portfoliosCountCard).toBeVisible();
    await expect(dashboard.holdingsCard).toBeVisible();
  });

  test('shows empty state with link to portfolio page when no portfolios', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await expect(dashboard.emptyState).toBeVisible({ timeout: 5_000 });
    const link = page.locator('a', { hasText: 'Create one' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/portfolio');
  });

  test('shows portfolio summary after portfolio is created', async ({ page }) => {
    const portfolioPage = new PortfolioPage(page);
    const name = `Dashboard Test Portfolio ${Date.now()}`;

    await portfolioPage.goto();
    await portfolioPage.createPortfolio(name);
    await expect(page.locator('h3', { hasText: name })).toBeVisible({ timeout: 5_000 });

    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await expect(dashboard.portfolioSummaryCard(name)).toBeVisible({ timeout: 5_000 });
  });

  test('portfolio count stat shows non-zero after creating a portfolio', async ({ page }) => {
    const portfolioPage = new PortfolioPage(page);
    await portfolioPage.goto();
    await portfolioPage.createPortfolio(`Count Test ${Date.now()}`);

    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    // Wait for portfolios to load, then assert count is at least 1
    const countLocator = page
      .locator('p', { hasText: 'Portfolios' })
      .first()
      .locator('..')
      .locator('p.text-2xl');
    await expect(countLocator).not.toHaveText('0', { timeout: 8_000 });
  });
});
