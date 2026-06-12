import { test, expect } from '@playwright/test';
import { RegisterPage, LoginPage } from '../pages/auth.page';
import { HomePage } from '../pages/home.page';

const PASSWORD = 'Test1234!';

// Market movers endpoint requires auth — tests run with a logged-in user.
test.describe('Market movers', () => {
  let testEmail: string;

  test.beforeAll(async ({ browser }) => {
    testEmail = `e2e+market+${Date.now()}@example.com`;
    const page = await browser.newPage();
    const registerPage = new RegisterPage(page);
    await registerPage.goto();
    await registerPage.register(testEmail, PASSWORD);
    await page.waitForURL('**/dashboard', { timeout: 30_000, waitUntil: 'commit' });
    await page.close();
  });

  test.beforeEach(async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(testEmail, PASSWORD);
    await page.waitForURL('**/dashboard', { timeout: 30_000, waitUntil: 'commit' });
  });

  test('home page shows Top Gainers and Top Losers sections', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await expect(home.gainersSection).toBeVisible({ timeout: 10_000 });
    await expect(home.losersSection).toBeVisible({ timeout: 10_000 });
  });

  test('Top Gainers shows at least one stock', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await expect(home.gainersSection).toBeVisible({ timeout: 10_000 });
    const firstGainer = home.firstGainerLink();
    await expect(firstGainer).toBeVisible({ timeout: 10_000 });
  });

  test('Top Losers shows at least one stock', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await expect(home.losersSection).toBeVisible({ timeout: 10_000 });
    const firstLoser = home.firstLoserLink();
    await expect(firstLoser).toBeVisible({ timeout: 10_000 });
  });

  test('gainers show green positive percentages', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await expect(home.gainersSection).toBeVisible({ timeout: 10_000 });

    const gainersContainer = home.gainersSection.locator('../..');
    const greenPercent = gainersContainer.locator('.text-green-400').first();
    await expect(greenPercent).toBeVisible({ timeout: 5_000 });
    await expect(greenPercent).toContainText('+');
  });

  test('losers show red negative percentages', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await expect(home.losersSection).toBeVisible({ timeout: 10_000 });

    const losersContainer = home.losersSection.locator('../..');
    const redPercent = losersContainer.locator('.text-red-400').first();
    await expect(redPercent).toBeVisible({ timeout: 5_000 });
    await expect(redPercent).toContainText('-');
  });

  test('clicking a gainer navigates to its stock page', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await expect(home.gainersSection).toBeVisible({ timeout: 10_000 });

    const firstGainer = home.firstGainerLink();
    await expect(firstGainer).toBeVisible({ timeout: 10_000 });

    const symbol = await firstGainer.locator('span.font-medium').textContent();
    await firstGainer.click();
    await page.waitForURL(`**/stocks/${symbol}`, { timeout: 5_000 });
    await expect(page).toHaveURL(new RegExp(`/stocks/${symbol}`));
  });
});
