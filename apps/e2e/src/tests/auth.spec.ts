import { test, expect } from '@playwright/test';
import { LoginPage, RegisterPage } from '../pages/auth.page';

const uniqueEmail = () => `e2e+${Date.now()}@example.com`;
const PASSWORD = 'Test1234!';

test.describe('Registration', () => {
  test('registers a new user and redirects to dashboard', async ({ page }) => {
    const registerPage = new RegisterPage(page);
    await registerPage.goto();
    await expect(page).toHaveTitle(/Yana Stocks/i);

    await registerPage.register(uniqueEmail(), PASSWORD);
    await page.waitForURL('**/dashboard', { timeout: 10_000 });
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('shows error for duplicate email', async ({ page }) => {
    const email = uniqueEmail();
    const registerPage = new RegisterPage(page);

    await registerPage.goto();
    await registerPage.register(email, PASSWORD);
    await page.waitForURL('**/dashboard', { timeout: 10_000 });

    await registerPage.goto();
    await registerPage.register(email, PASSWORD);
    await expect(registerPage.errorMessage).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('Login', () => {
  let testEmail: string;

  test.beforeAll(async ({ browser }) => {
    testEmail = uniqueEmail();
    const page = await browser.newPage();
    const registerPage = new RegisterPage(page);
    await registerPage.goto();
    await registerPage.register(testEmail, PASSWORD);
    await page.waitForURL('**/dashboard', { timeout: 10_000 });
    await page.close();
  });

  test('logs in with valid credentials', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(testEmail, PASSWORD);
    await page.waitForURL('**/dashboard', { timeout: 10_000 });
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('shows error for invalid password', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(testEmail, 'wrongpassword');
    await expect(loginPage.errorMessage).toBeVisible({ timeout: 5_000 });
    await expect(loginPage.errorMessage).toContainText(/invalid/i);
  });

  test('protected route redirects unauthenticated user to login', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL('**/login', { timeout: 5_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test('navbar shows logout after login', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(testEmail, PASSWORD);
    await page.waitForURL('**/dashboard', { timeout: 10_000 });
    await expect(page.locator('button', { hasText: 'Logout' })).toBeVisible();
  });
});
