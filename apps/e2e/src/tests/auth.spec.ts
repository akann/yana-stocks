import { test, expect } from '../fixtures/base.fixture';
import {
  MOCK_USER,
  MOCK_PROFILE,
  fulfill,
  setupAuthSession,
  mockMovers,
  mockPortfoliosEndpoint,
} from '../fixtures/api-mocks';

test.describe('Login page', () => {
  test('renders email, password fields and sign-in button', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('#login-email')).toBeVisible();
    await expect(page.locator('#login-password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Register' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Forgot password?' })).toBeVisible();
  });

  test('shows error message on invalid credentials', async ({ page }) => {
    await page.route(/\/api\/auth\/login$/, (route) =>
      fulfill(route, { error: 'Invalid credentials' }, 401),
    );

    await page.goto('/login');
    await page.locator('#login-email').fill('bad@test.com');
    await page.locator('#login-password').fill('wrongpassword');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByText('Invalid credentials')).toBeVisible();
  });

  test('shows "Signing in…" while request is in flight', async ({ page }) => {
    // Never resolves — keeps the loading state visible
    await page.route(/\/api\/auth\/login$/, () => new Promise(() => {}));

    await page.goto('/login');
    await page.locator('#login-email').fill('user@test.com');
    await page.locator('#login-password').fill('password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('button', { name: 'Signing in…' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
  });

  test('redirects to /dashboard on successful login', async ({ page }) => {
    await page.route(/\/api\/auth\/login$/, (route) =>
      fulfill(route, { accessToken: 'tok', refreshToken: 'ref' }),
    );
    await page.route(/\/api\/auth\/me$/, (route) => fulfill(route, MOCK_USER));
    await page.route(/\/api\/profile\/me$/, (route) => fulfill(route, MOCK_PROFILE));
    await mockPortfoliosEndpoint(page);

    await page.goto('/login');
    await page.locator('#login-email').fill('user@test.com');
    await page.locator('#login-password').fill('password123');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await page.waitForURL(/\/dashboard/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('MFA step renders code input when login returns mfaRequired:true', async ({ page }) => {
    await page.route(/\/api\/auth\/login$/, (route) =>
      fulfill(route, { mfaRequired: true, mfaToken: 'pending-mfa-token' }),
    );

    await page.goto('/login');
    await page.locator('#login-email').fill('mfa@test.com');
    await page.locator('#login-password').fill('password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByText('Two-factor authentication')).toBeVisible();
    await expect(page.getByPlaceholder('000000')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Verify' })).toBeVisible();
  });
});

test.describe('Auth guard — unauthenticated redirects', () => {
  for (const path of ['/dashboard', '/portfolio', '/watchlist']) {
    test(`${path} redirects to /login when not logged in`, async ({ page }) => {
      await page.goto(path);
      await page.waitForURL(/\/login/, { timeout: 10_000 });
      await expect(page).toHaveURL(/\/login/);
    });
  }
});

test.describe('Navbar auth state', () => {
  test('unauthenticated: shows Sign in and Sign up, hides app nav links', async ({ page }) => {
    await mockMovers(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign up' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Dashboard' })).not.toBeVisible();
    await expect(page.getByRole('link', { name: 'Portfolio' })).not.toBeVisible();
  });

  test('authenticated: shows app nav links and user avatar, hides sign-in link', async ({
    page,
  }) => {
    await mockMovers(page);
    await setupAuthSession(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Portfolio' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Watchlist' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in' })).not.toBeVisible();
  });

  test('authenticated: user menu opens on avatar click with profile link and sign out', async ({
    page,
  }) => {
    await mockMovers(page);
    await setupAuthSession(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Open the avatar dropdown
    await page.getByRole('button', { name: 'Test User' }).click();
    await expect(page.getByRole('link', { name: 'Your profile' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });
});
