/**
 * E2E tests for the /profile page.
 *
 * API calls are intercepted via page.route() — no real backend required.
 * Auth state is seeded via sessionStorage before navigation.
 */
import { test, expect } from '@playwright/test';
import { MOCK_ACCESS_TOKEN, MOCK_REFRESH_TOKEN } from '../fixtures/data';

// Minimal Base64url-encoded JWT where payload = { sub: "user-1", email: "ada@example.com" }
const PAYLOAD_B64 = Buffer.from(
  JSON.stringify({ sub: 'user-1', email: 'ada@example.com' }),
).toString('base64url');
const FAKE_JWT = `eyJhbGciOiJIUzI1NiJ9.${PAYLOAD_B64}.fakesig`;

const MOCK_PROFILE = {
  userId: 'user-1',
  displayName: 'Ada Lovelace',
  avatar: '',
  bio: 'Engineer',
  preferences: { theme: 'dark', defaultCurrency: 'USD', emailNotifications: true },
};

async function seedAuth(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(
    ({ at, rt, jwt }) => {
      sessionStorage.setItem('access_token', at);
      sessionStorage.setItem('refresh_token', rt);
      // Some contexts check the decoded user id from the token
      sessionStorage.setItem('fake_jwt', jwt);
    },
    { at: MOCK_ACCESS_TOKEN, rt: MOCK_REFRESH_TOKEN, jwt: FAKE_JWT },
  );
}

function mockProfileRoutes(page: import('@playwright/test').Page, profile = MOCK_PROFILE) {
  void page.route('**/api/profile/me', (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ json: profile });
    // PUT
    return r.fulfill({ json: { ...profile, ...JSON.parse(r.request().postData() ?? '{}') } });
  });
  void page.route('**/api/auth/password', (r) =>
    r.fulfill({ json: { message: 'password updated' } }),
  );
}

test.describe('Profile page', () => {
  test('auth guard: redirects to /login when unauthenticated', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForURL('/login');
    await expect(page).toHaveURL('/login');
  });

  test('renders Profile tab and Security tab for authenticated user', async ({ page }) => {
    mockProfileRoutes(page);
    await seedAuth(page);
    await page.goto('/profile');

    await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Profile' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Security' })).toBeVisible();
  });

  test('Profile tab shows editable fields', async ({ page }) => {
    mockProfileRoutes(page);
    await seedAuth(page);
    await page.goto('/profile');

    await expect(page.getByPlaceholder('Your name')).toBeVisible();
    await expect(page.getByPlaceholder('A short bio')).toBeVisible();
    await expect(page.getByPlaceholder(/example.com\/avatar/)).toBeVisible();
  });

  test('Security tab shows password fields after clicking tab', async ({ page }) => {
    mockProfileRoutes(page);
    await seedAuth(page);
    await page.goto('/profile');

    await page.getByRole('button', { name: 'Security' }).click();

    await expect(page.getByLabel('Current password')).toBeVisible();
    await expect(page.getByLabel('New password')).toBeVisible();
    await expect(page.getByLabel('Confirm new password')).toBeVisible();
  });

  test('save profile button submits form and shows success', async ({ page }) => {
    mockProfileRoutes(page);
    await seedAuth(page);
    await page.goto('/profile');

    await page.getByPlaceholder('Your name').fill('New Name');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByText('Profile saved.')).toBeVisible();
  });

  test('password validation: shows error when new password is shorter than 8 chars', async ({
    page,
  }) => {
    mockProfileRoutes(page);
    await seedAuth(page);
    await page.goto('/profile');

    await page.getByRole('button', { name: 'Security' }).click();
    await page.getByLabel('Current password').fill('OldPass1!');
    await page.getByLabel('New password').fill('short');
    await page.getByLabel('Confirm new password').fill('short');
    await page.getByRole('button', { name: 'Update password' }).click();

    await expect(page.getByText(/at least 8 characters/i)).toBeVisible();
  });

  test('password validation: shows error when passwords do not match', async ({ page }) => {
    mockProfileRoutes(page);
    await seedAuth(page);
    await page.goto('/profile');

    await page.getByRole('button', { name: 'Security' }).click();
    await page.getByLabel('Current password').fill('OldPass1!');
    await page.getByLabel('New password').fill('NewPass1!');
    await page.getByLabel('Confirm new password').fill('DifferentPass1!');
    await page.getByRole('button', { name: 'Update password' }).click();

    await expect(page.getByText(/do not match/i)).toBeVisible();
  });

  test('successful password change shows success message and clears fields', async ({ page }) => {
    mockProfileRoutes(page);
    await seedAuth(page);
    await page.goto('/profile');

    await page.getByRole('button', { name: 'Security' }).click();
    await page.getByLabel('Current password').fill('OldPass1!');
    await page.getByLabel('New password').fill('NewPass1!');
    await page.getByLabel('Confirm new password').fill('NewPass1!');
    await page.getByRole('button', { name: 'Update password' }).click();

    await expect(page.getByText('Password updated.')).toBeVisible();

    // Fields should be cleared after success
    await expect(page.getByLabel('Current password')).toHaveValue('');
    await expect(page.getByLabel('New password')).toHaveValue('');
    await expect(page.getByLabel('Confirm new password')).toHaveValue('');
  });

  test('wrong current password: API 401 shows error message', async ({ page }) => {
    void page.route('**/api/profile/me', (r) => r.fulfill({ json: MOCK_PROFILE }));
    void page.route('**/api/auth/password', (r) =>
      r.fulfill({ status: 401, json: { error: 'current password is incorrect' } }),
    );

    await seedAuth(page);
    await page.goto('/profile');

    await page.getByRole('button', { name: 'Security' }).click();
    await page.getByLabel('Current password').fill('WrongPass1!');
    await page.getByLabel('New password').fill('NewPass1!');
    await page.getByLabel('Confirm new password').fill('NewPass1!');
    await page.getByRole('button', { name: 'Update password' }).click();

    await expect(page.getByText(/current password is incorrect/i)).toBeVisible();
  });
});
