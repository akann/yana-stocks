/**
 * Auth tests cover: login, register, auth guards, logout.
 *
 * Prerequisite: Next.js frontend running with NEXT_PUBLIC_API_URL=http://localhost:3004/api
 * All API calls are intercepted via page.route() — no real backend required.
 */
import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';
import {
  MOCK_ACCESS_TOKEN,
  MOCK_REFRESH_TOKEN,
  TEST_PASSWORD,
  uniqueEmail,
} from '../fixtures/data';

const AUTH_TOKENS = { accessToken: MOCK_ACCESS_TOKEN, refreshToken: MOCK_REFRESH_TOKEN };

test.describe('Login', () => {
  test('renders login form', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(login.emailInput).toBeVisible();
    await expect(login.passwordInput).toBeVisible();
    await expect(login.submitButton).toBeVisible();
  });

  test('redirects to /dashboard on success', async ({ page }) => {
    await page.route('**/api/auth/login', (r) => r.fulfill({ json: AUTH_TOKENS }));
    await page.route('**/api/portfolio/portfolios', (r) => r.fulfill({ json: [] }));

    const login = new LoginPage(page);
    await login.goto();
    await login.login('user@example.com', TEST_PASSWORD);
    await page.waitForURL('/dashboard');
    await expect(page).toHaveURL('/dashboard');
  });

  test('shows error on invalid credentials', async ({ page }) => {
    await page.route('**/api/auth/login', (r) => r.fulfill({ status: 401, json: {} }));

    const login = new LoginPage(page);
    await login.goto();
    await login.login('bad@example.com', 'wrongpassword');
    // Wait for the submit button to re-enable (setLoading(false) in finally block)
    // before asserting the error, avoiding a race on slow mobile renderers.
    await expect(login.submitButton).toBeEnabled();
    await expect(login.error).toBeVisible();
  });

  test('stores tokens in localStorage after login', async ({ page }) => {
    await page.route('**/api/auth/login', (r) => r.fulfill({ json: AUTH_TOKENS }));
    await page.route('**/api/portfolio/portfolios', (r) => r.fulfill({ json: [] }));

    const login = new LoginPage(page);
    await login.goto();
    await login.login('user@example.com', TEST_PASSWORD);
    await page.waitForURL('/dashboard');

    const at = await page.evaluate(() => localStorage.getItem('access_token'));
    const rt = await page.evaluate(() => localStorage.getItem('refresh_token'));
    expect(at).toBe(MOCK_ACCESS_TOKEN);
    expect(rt).toBe(MOCK_REFRESH_TOKEN);
  });

  test('has link to register page', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.registerLink.click();
    await expect(page).toHaveURL('/register');
  });
});

test.describe('Register', () => {
  test('renders registration form', async ({ page }) => {
    const register = new RegisterPage(page);
    await register.goto();
    await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible();
    await expect(register.emailInput).toBeVisible();
    await expect(register.passwordInput).toBeVisible();
    await expect(register.submitButton).toBeVisible();
  });

  test('redirects to /dashboard on success', async ({ page }) => {
    await page.route('**/api/auth/register', (r) => r.fulfill({ json: AUTH_TOKENS }));
    await page.route('**/api/portfolio/portfolios', (r) => r.fulfill({ json: [] }));

    const register = new RegisterPage(page);
    await register.goto();
    await register.register(uniqueEmail(), TEST_PASSWORD);
    await page.waitForURL('/dashboard');
    await expect(page).toHaveURL('/dashboard');
  });

  test('shows error on duplicate email', async ({ page }) => {
    await page.route('**/api/auth/register', (r) =>
      r.fulfill({ status: 409, json: { message: 'Email already in use' } }),
    );

    const register = new RegisterPage(page);
    await register.goto();
    await register.register('existing@example.com', TEST_PASSWORD);
    await expect(register.error).toBeVisible();
  });

  test('has link to login page', async ({ page }) => {
    const register = new RegisterPage(page);
    await register.goto();
    await register.signInLink.click();
    await expect(page).toHaveURL('/login');
  });
});

test.describe('Auth guards', () => {
  test('redirects /dashboard to /login when unauthenticated', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL('/login');
    await expect(page).toHaveURL('/login');
  });

  test('redirects /portfolio to /login when unauthenticated', async ({ page }) => {
    await page.goto('/portfolio');
    await page.waitForURL('/login');
    await expect(page).toHaveURL('/login');
  });

  test('redirects /watchlist to /login when unauthenticated', async ({ page }) => {
    await page.goto('/watchlist');
    await page.waitForURL('/login');
    await expect(page).toHaveURL('/login');
  });
});

test.describe('Logout', () => {
  test('clears tokens and redirects to /login', async ({ page }) => {
    await page.route('**/api/portfolio/portfolios', (r) => r.fulfill({ json: [] }));
    await page.route('**/api/auth/logout', (r) => r.fulfill({ status: 200, json: {} }));

    // Establish authenticated session
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(
      ({ at, rt }) => {
        localStorage.setItem('access_token', at);
        localStorage.setItem('refresh_token', rt);
      },
      { at: MOCK_ACCESS_TOKEN, rt: MOCK_REFRESH_TOKEN },
    );

    await page.goto('/dashboard');
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('/login');
    await expect(page).toHaveURL('/login');

    const at = await page.evaluate(() => localStorage.getItem('access_token'));
    expect(at).toBeNull();
  });

  test('navbar shows Sign in / Get started when logged out', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Get started' })).toBeVisible();
  });
});
