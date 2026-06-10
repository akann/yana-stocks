import { test, expect } from '@playwright/test';
import { RegisterPage } from '../pages/auth.page';
import { PortfolioPage } from '../pages/portfolio.page';

const PASSWORD = 'Test1234!';

test.describe('Portfolio management', () => {
  let testEmail: string;

  test.beforeAll(async ({ browser }) => {
    testEmail = `e2e+portfolio+${Date.now()}@example.com`;
    const page = await browser.newPage();
    const registerPage = new RegisterPage(page);
    await registerPage.goto();
    await registerPage.register(testEmail, PASSWORD);
    await page.waitForURL('**/dashboard', { timeout: 20_000 });
    await page.close();
  });

  test.beforeEach(async ({ page }) => {
    const { LoginPage } = await import('../pages/auth.page');
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(testEmail, PASSWORD);
    await page.waitForURL('**/dashboard', { timeout: 20_000 });
  });

  test('creates a new portfolio', async ({ page }) => {
    const portfolioPage = new PortfolioPage(page);
    const name = `My Portfolio ${Date.now()}`;

    await portfolioPage.goto();
    await portfolioPage.createPortfolio(name);
    await expect(page.locator('h3', { hasText: name })).toBeVisible({ timeout: 5_000 });
  });

  test('adds a stock to a portfolio', async ({ page }) => {
    const portfolioPage = new PortfolioPage(page);
    const name = `Test Portfolio ${Date.now()}`;

    await portfolioPage.goto();
    await portfolioPage.createPortfolio(name);
    await expect(page.locator('h3', { hasText: name })).toBeVisible({ timeout: 5_000 });

    await portfolioPage.openAddStock(name);
    await portfolioPage.addStock('AAPL', '10', '150.00');

    await expect(page.locator('td', { hasText: 'AAPL' })).toBeVisible({ timeout: 5_000 });
  });

  test('shows empty state when portfolio has no holdings', async ({ page }) => {
    const portfolioPage = new PortfolioPage(page);
    const name = `Empty Portfolio ${Date.now()}`;

    await portfolioPage.goto();
    await portfolioPage.createPortfolio(name);
    const card = portfolioPage.portfolioCard(name);
    await expect(card.locator('h3', { hasText: name })).toBeVisible({ timeout: 5_000 });
    await expect(card.getByText('No holdings yet')).toBeVisible({ timeout: 5_000 });
  });

  test('portfolio page redirects to login when unauthenticated', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
    });
    await page.goto('/portfolio');
    await page.waitForURL('**/login', { timeout: 5_000 });
    await expect(page).toHaveURL(/\/login/);
  });
});
