/**
 * Auth tests cover: login (email/password), register, email verification, auth guards, logout.
 *
 * API calls are intercepted via page.route() so no real backend is required.
 */
import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage';
import { ResetPasswordPage } from '../pages/ResetPasswordPage';
import {
  MOCK_ACCESS_TOKEN,
  MOCK_REFRESH_TOKEN,
  TEST_PASSWORD,
  uniqueEmail,
} from '../fixtures/data';

test.describe('Login', () => {
  test('renders login page with email and password fields', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(login.emailInput).toBeVisible();
    await expect(login.passwordInput).toBeVisible();
    await expect(login.submitButton).toBeVisible();
  });

  test('logs in with valid credentials and redirects to dashboard', async ({ page }) => {
    await page.route('**/api/auth/login', (r) =>
      r.fulfill({ json: { accessToken: MOCK_ACCESS_TOKEN, refreshToken: MOCK_REFRESH_TOKEN } }),
    );
    await page.route('**/api/portfolio/portfolios', (r) => r.fulfill({ json: [] }));

    const login = new LoginPage(page);
    await login.goto();
    await login.login('user@example.com', TEST_PASSWORD);

    await page.waitForURL('/dashboard');
    await expect(page).toHaveURL('/dashboard');
  });

  test('shows error message for invalid credentials', async ({ page }) => {
    await page.route('**/api/auth/login', (r) =>
      r.fulfill({ status: 401, json: { message: 'Invalid credentials' } }),
    );

    const login = new LoginPage(page);
    await login.goto();
    await login.login('wrong@example.com', 'wrongpass');

    await expect(page.getByText('Invalid credentials')).toBeVisible();
    await expect(page).toHaveURL('/login');
  });

  test('shows error for unverified account', async ({ page }) => {
    await page.route('**/api/auth/login', (r) =>
      r.fulfill({ status: 403, json: { message: 'Please verify your email before signing in' } }),
    );

    const login = new LoginPage(page);
    await login.goto();
    await login.login('unverified@example.com', TEST_PASSWORD);

    await expect(page.getByText(/verify your email/i)).toBeVisible();
  });

  test('has link to register page', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.registerLink.click();
    await expect(page).toHaveURL('/register');
  });

  test('has "Forgot password?" link that navigates to /forgot-password', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.forgotPasswordLink.click();
    await expect(page).toHaveURL('/forgot-password');
  });
});

test.describe('Register', () => {
  test('renders registration form with email, name, and password fields', async ({ page }) => {
    const register = new RegisterPage(page);
    await register.goto();
    await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible();
    await expect(register.emailInput).toBeVisible();
    await expect(register.passwordInput).toBeVisible();
    await expect(register.submitButton).toBeVisible();
  });

  test('shows check-your-inbox after successful registration', async ({ page }) => {
    await page.route('**/api/auth/register', (r) =>
      r.fulfill({ status: 201, json: { message: 'Verification email sent.' } }),
    );

    const register = new RegisterPage(page);
    await register.goto();
    await register.register(uniqueEmail(), TEST_PASSWORD, 'Test User');
    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();
  });

  test('shows error on duplicate email', async ({ page }) => {
    await page.route('**/api/auth/register', (r) =>
      r.fulfill({ status: 409, json: { message: 'Email already registered' } }),
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

test.describe('Email verification', () => {
  test('shows success message with valid token', async ({ page }) => {
    await page.route('**/api/auth/verify', (r) =>
      r.fulfill({ json: { message: 'Email verified. You can now sign in.' } }),
    );

    await page.goto('/verify?token=valid-token-abc');
    await expect(page.getByText(/email verified/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /go to sign in/i })).toBeVisible();
  });

  test('shows error for expired or invalid token', async ({ page }) => {
    await page.route('**/api/auth/verify', (r) =>
      r.fulfill({ status: 403, json: { message: 'Verification token expired' } }),
    );

    await page.goto('/verify?token=expired-token');
    await expect(page.getByText(/token expired/i)).toBeVisible();
  });

  test('shows error when token param is missing', async ({ page }) => {
    await page.goto('/verify');
    await expect(page.getByText(/missing verification token/i)).toBeVisible();
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

  test('redirects /profile to /login when unauthenticated', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForURL('/login');
    await expect(page).toHaveURL('/login');
  });
});

test.describe('Logout', () => {
  test('clears session and redirects to login', async ({ page }) => {
    await page.route('**/api/portfolio/portfolios', (r) => r.fulfill({ json: [] }));
    await page.route('**/api/auth/logout', (r) =>
      r.fulfill({ json: { message: 'Logged out successfully' } }),
    );

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
    await page.getByRole('button', { name: 'My Account' }).click();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('/login');
    await expect(page).toHaveURL('/login');

    const at = await page.evaluate(() => sessionStorage.getItem('access_token'));
    const rt = await page.evaluate(() => sessionStorage.getItem('refresh_token'));
    expect(at).toBeNull();
    expect(rt).toBeNull();
  });

  test('navbar shows Sign in / Sign up when logged out', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign up' })).toBeVisible();
  });
});

test.describe('Forgot password', () => {
  test('renders heading and email input', async ({ page }) => {
    const fp = new ForgotPasswordPage(page);
    await fp.goto();
    await expect(page.getByRole('heading', { name: 'Forgot password' })).toBeVisible();
    await expect(fp.emailInput).toBeVisible();
    await expect(fp.submitButton).toBeVisible();
  });

  test('shows confirmation after submitting email', async ({ page }) => {
    await page.route('**/api/auth/password/reset-request', (r) =>
      r.fulfill({ json: { message: 'if that email is registered you will receive a reset link' } }),
    );

    const fp = new ForgotPasswordPage(page);
    await fp.goto();
    await fp.submit('user@example.com');

    await expect(page.getByText(/check your inbox/i)).toBeVisible();
  });

  test('shows confirmation even when email is not registered (no enumeration)', async ({
    page,
  }) => {
    await page.route('**/api/auth/password/reset-request', (r) =>
      r.fulfill({ json: { message: 'if that email is registered you will receive a reset link' } }),
    );

    const fp = new ForgotPasswordPage(page);
    await fp.goto();
    await fp.submit('notregistered@example.com');

    await expect(page.getByText(/check your inbox/i)).toBeVisible();
  });

  test('has "Back to sign in" link', async ({ page }) => {
    const fp = new ForgotPasswordPage(page);
    await fp.goto();
    await fp.backToSignInLink.click();
    await expect(page).toHaveURL('/login');
  });
});

test.describe('Reset password', () => {
  test('shows error when token param is missing', async ({ page }) => {
    await page.goto('/reset-password');
    await expect(page.getByText(/invalid or missing reset link/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /request a new one/i })).toBeVisible();
  });

  test('shows password form when token is present', async ({ page }) => {
    const rp = new ResetPasswordPage(page);
    await rp.goto('some-token');
    await expect(page.getByRole('heading', { name: 'Set new password' })).toBeVisible();
    await expect(rp.newPasswordInput).toBeVisible();
    await expect(rp.confirmPasswordInput).toBeVisible();
    await expect(rp.submitButton).toBeVisible();
  });

  test('shows error when passwords do not match', async ({ page }) => {
    const rp = new ResetPasswordPage(page);
    await rp.goto('some-token');
    await rp.newPasswordInput.fill('NewPass1!');
    await rp.confirmPasswordInput.fill('DifferentPass1!');
    await rp.submitButton.click();

    await expect(page.getByText(/do not match/i)).toBeVisible();
  });

  test('shows error when password is shorter than 8 characters', async ({ page }) => {
    const rp = new ResetPasswordPage(page);
    await rp.goto('some-token');
    await rp.newPasswordInput.fill('short');
    await rp.confirmPasswordInput.fill('short');
    await rp.submitButton.click();

    await expect(page.getByText(/at least 8 characters/i)).toBeVisible();
  });

  test('shows error for invalid or expired token', async ({ page }) => {
    await page.route('**/api/auth/password/reset', (r) =>
      r.fulfill({ status: 400, json: { error: 'invalid or expired reset link' } }),
    );

    const rp = new ResetPasswordPage(page);
    await rp.goto('expired-token');
    await rp.reset('NewPass1!');

    await expect(page.getByText(/invalid or expired reset link/i)).toBeVisible();
  });

  test('shows success and redirects to /login on valid reset', async ({ page }) => {
    await page.route('**/api/auth/password/reset', (r) =>
      r.fulfill({ json: { message: 'password reset successfully' } }),
    );

    const rp = new ResetPasswordPage(page);
    await rp.goto('valid-token');
    await rp.reset('NewPass1!');

    await expect(page.getByText(/password updated/i)).toBeVisible();
    await page.waitForURL('/login');
    await expect(page).toHaveURL('/login');
  });
});
