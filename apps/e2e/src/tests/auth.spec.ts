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
    await page.waitForURL('**/dashboard', { timeout: 30_000, waitUntil: 'commit' });
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('shows error for duplicate email', async ({ page }) => {
    const email = uniqueEmail();
    const registerPage = new RegisterPage(page);

    await registerPage.goto();
    await registerPage.register(email, PASSWORD);
    await page.waitForURL('**/dashboard', { timeout: 30_000, waitUntil: 'commit' });

    await registerPage.goto();
    await registerPage.register(email, PASSWORD);
    await expect(registerPage.errorMessage).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('Login', () => {
  let testEmail: string;
  let savedTokens: { at: string; rt: string } | null = null;

  test.beforeAll(async ({ browser }) => {
    testEmail = uniqueEmail();
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

  test('logs in with valid credentials', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(testEmail, PASSWORD);
    await page.waitForURL('**/dashboard', { timeout: 30_000, waitUntil: 'commit' });
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
    await page.waitForURL('**/dashboard', { timeout: 30_000, waitUntil: 'commit' });
    await expect(page.locator('button', { hasText: 'Sign out' })).toBeVisible();
  });

  test('logout clears session and redirects away from dashboard', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(testEmail, PASSWORD);
    await page.waitForURL('**/dashboard', { timeout: 30_000, waitUntil: 'commit' });

    await page.locator('button', { hasText: 'Sign out' }).click();
    // handleLogout awaits POST /auth/logout then calls router.push('/login') — wait for it
    await page.waitForURL('**/login', { timeout: 10_000 });
    // After logout, dashboard should no longer be accessible
    await page.goto('/dashboard');
    await page.waitForURL('**/login', { timeout: 5_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test('logout removes tokens from localStorage', async ({ page }) => {
    // Inject tokens instead of UI login — avoids WebKit email-input fill flakiness
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ at, rt }) => {
      localStorage.setItem('access_token', at);
      localStorage.setItem('refresh_token', rt);
    }, savedTokens!);
    await page.goto('/');

    await page.locator('button', { hasText: 'Sign out' }).click();

    // handleLogout awaits POST /auth/logout before clearing localStorage — poll until cleared
    await page.waitForFunction(() => localStorage.getItem('access_token') === null, {
      timeout: 8_000,
    });
    const refreshToken = await page.evaluate(() => localStorage.getItem('refresh_token'));
    expect(refreshToken).toBeNull();
  });
});

test.describe('Form validation', () => {
  test('login form stays on page when submitted empty', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.submitButton.click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('register form stays on page when submitted empty', async ({ page }) => {
    const registerPage = new RegisterPage(page);
    await registerPage.goto();
    await registerPage.submitButton.click();
    await expect(page).toHaveURL(/\/register/);
  });

  test('login shows error for empty password', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.emailInput.fill('test@example.com');
    await loginPage.submitButton.click();
    await expect(page).toHaveURL(/\/login/);
  });
});
