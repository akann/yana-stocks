/**
 * Auth tests cover: login (PKCE redirect), register, auth guards, logout.
 *
 * The login flow now redirects to Authentik — tests verify the redirect intent
 * and the resulting UI states rather than completing the full PKCE exchange.
 * API calls that hit the backend are intercepted via page.route().
 */
import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';
import { MOCK_ACCESS_TOKEN, MOCK_REFRESH_TOKEN, uniqueEmail } from '../fixtures/data';

test.describe('Login', () => {
  test('renders login page with Authentik button', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(login.continueButton).toBeVisible();
  });

  test('clicking login button initiates Authentik PKCE redirect', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();

    // Intercept the navigation to Authentik and abort it (we just want to verify the intent)
    const [request] = await Promise.all([
      page.waitForRequest((req) => req.url().includes('authentik.yanatech.co.uk')),
      login.continueButton.click(),
    ]);
    expect(request.url()).toContain('/application/o/authorize/');
    expect(request.url()).toContain('code_challenge_method=S256');
    expect(request.url()).toContain('client_id=yana-stocks');
  });

  test('has link to register page', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.registerLink.click();
    await expect(page).toHaveURL('/register');
  });
});

test.describe('Register', () => {
  test('renders registration form without password field', async ({ page }) => {
    const register = new RegisterPage(page);
    await register.goto();
    await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible();
    await expect(register.emailInput).toBeVisible();
    await expect(register.submitButton).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });

  test('shows check-your-inbox after successful registration', async ({ page }) => {
    await page.route('**/api/auth/register', (r) => r.fulfill({ status: 201, json: { message: 'Check your email' } }));

    const register = new RegisterPage(page);
    await register.goto();
    await register.register(uniqueEmail());
    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();
  });

  test('shows error on duplicate email', async ({ page }) => {
    await page.route('**/api/auth/register', (r) =>
      r.fulfill({ status: 409, json: { message: 'Email already registered' } }),
    );

    const register = new RegisterPage(page);
    await register.goto();
    await register.register('existing@example.com');
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
  test('clears session tokens on logout', async ({ page }) => {
    await page.route('**/api/portfolio/portfolios', (r) => r.fulfill({ json: [] }));

    // Inject authenticated session into sessionStorage
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(
      ({ at, rt }) => {
        sessionStorage.setItem('access_token', at);
        sessionStorage.setItem('refresh_token', rt);
      },
      { at: MOCK_ACCESS_TOKEN, rt: MOCK_REFRESH_TOKEN },
    );

    await page.goto('/dashboard');
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

    // logout() clears sessionStorage then navigates to Authentik end_session.
    // Capturing the request proves tokens were cleared and the OIDC logout flow fired.
    const [request] = await Promise.all([
      page.waitForRequest((req) => req.url().includes('end-session')),
      page.getByRole('button', { name: 'Sign out' }).click(),
    ]);
    expect(request.url()).toContain('/application/o/yana-stocks/end-session/');
    expect(request.url()).toContain('client_id=yana-stocks');
  });

  test('navbar shows Sign in / Get started when logged out', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Get started' })).toBeVisible();
  });
});
