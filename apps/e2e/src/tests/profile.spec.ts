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
  // Await route registration so WebKit processes interceptors before navigation
  await page.route('**/api/auth/me', (r) =>
    r.fulfill({ json: { userId: 'user-1', email: 'ada@example.com' } }),
  );
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(
    ({ at, rt, jwt }) => {
      sessionStorage.setItem('access_token', at);
      sessionStorage.setItem('refresh_token', rt);
      sessionStorage.setItem('fake_jwt', jwt);
    },
    { at: MOCK_ACCESS_TOKEN, rt: MOCK_REFRESH_TOKEN, jwt: FAKE_JWT },
  );
}

async function mockProfileRoutes(page: import('@playwright/test').Page, profile = MOCK_PROFILE) {
  await page.route('**/api/profile/me', (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ json: profile });
    return r.fulfill({ json: { ...profile, ...JSON.parse(r.request().postData() ?? '{}') } });
  });
  await page.route('**/api/auth/password', (r) =>
    r.fulfill({ json: { message: 'password updated' } }),
  );
  await page.route('**/api/auth/account', (r) =>
    r.fulfill({ json: { message: 'account deleted' } }),
  );
  // Mock MFA status so getMFAStatus() doesn't hit a real server and trigger clearSession
  await page.route('**/api/auth/mfa', (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ json: { enabled: false } });
    if (r.request().method() === 'DELETE') return r.fulfill({ json: { message: 'MFA disabled' } });
    return r.fulfill({ status: 404, json: {} });
  });
}

async function mockMFARoutes(
  page: import('@playwright/test').Page,
  opts: {
    enabled?: boolean;
    setupError?: boolean;
    enableError?: string;
    disableError?: boolean;
  } = {},
) {
  await page.route('**/api/auth/mfa', (r) => {
    if (r.request().method() === 'GET') {
      return r.fulfill({ json: { enabled: opts.enabled ?? false } });
    }
    if (r.request().method() === 'DELETE') {
      if (opts.disableError) {
        return r.fulfill({ status: 500, json: { error: 'Failed to disable MFA' } });
      }
      return r.fulfill({ json: { message: 'MFA disabled' } });
    }
    return r.fulfill({ status: 404, json: {} });
  });
  await page.route('**/api/auth/mfa/setup', (r) => {
    if (opts.setupError) {
      return r.fulfill({ status: 500, json: { error: 'failed to generate MFA secret' } });
    }
    return r.fulfill({
      json: {
        otpAuthURL:
          'otpauth://totp/YanaStocks%3Aada%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=YanaStocks',
        secret: 'JBSWY3DPEHPK3PXP',
      },
    });
  });
  await page.route('**/api/auth/mfa/enable', (r) => {
    if (opts.enableError) {
      return r.fulfill({ status: 400, json: { error: opts.enableError } });
    }
    return r.fulfill({ json: { message: 'MFA enabled' } });
  });
}

test.describe('Profile page', () => {
  test('auth guard: redirects to /login when unauthenticated', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForURL('/login');
    await expect(page).toHaveURL('/login');
  });

  test('renders three tabs for authenticated user', async ({ page }) => {
    await mockProfileRoutes(page);
    await seedAuth(page);
    await page.goto('/profile');

    await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Profile' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change password' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete account' })).toBeVisible();
  });

  test('Profile tab shows editable fields', async ({ page }) => {
    await mockProfileRoutes(page);
    await seedAuth(page);
    await page.goto('/profile');

    await expect(page.getByPlaceholder('Your name')).toBeVisible();
    await expect(page.getByPlaceholder('A short bio')).toBeVisible();
    await expect(page.getByPlaceholder(/example.com\/avatar/)).toBeVisible();
  });

  test('Change password tab shows password fields', async ({ page }) => {
    await mockProfileRoutes(page);
    await seedAuth(page);
    await page.goto('/profile');

    await page.getByRole('button', { name: 'Change password' }).click();

    await expect(page.getByLabel('Current password')).toBeVisible();
    await expect(page.getByLabel('New password', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Confirm new password')).toBeVisible();
  });

  test('Delete account tab shows danger section', async ({ page }) => {
    await mockProfileRoutes(page);
    await seedAuth(page);
    await page.goto('/profile');

    await page.getByRole('button', { name: 'Delete account' }).click();

    await expect(page.getByRole('button', { name: 'Delete my account' })).toBeVisible();
    await expect(page.getByText(/permanently delete/i)).toBeVisible();
  });

  test('save profile button submits form and shows success', async ({ page }) => {
    await mockProfileRoutes(page);
    await seedAuth(page);
    await page.goto('/profile');

    await page.getByPlaceholder('Your name').fill('New Name');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByText('Profile saved.')).toBeVisible();
  });

  test('password validation: shows error when new password is shorter than 8 chars', async ({
    page,
  }) => {
    await mockProfileRoutes(page);
    await seedAuth(page);
    await page.goto('/profile');

    await page.getByRole('button', { name: 'Change password' }).click();
    await page.getByLabel('Current password').fill('OldPass1!');
    await page.getByLabel('New password', { exact: true }).fill('short');
    await page.getByLabel('Confirm new password').fill('short');
    await page.getByRole('button', { name: 'Update password' }).click();

    await expect(page.getByText(/at least 8 characters/i)).toBeVisible();
  });

  test('password validation: shows error when passwords do not match', async ({ page }) => {
    await mockProfileRoutes(page);
    await seedAuth(page);
    await page.goto('/profile');

    await page.getByRole('button', { name: 'Change password' }).click();
    await page.getByLabel('Current password').fill('OldPass1!');
    await page.getByLabel('New password', { exact: true }).fill('NewPass1!');
    await page.getByLabel('Confirm new password').fill('DifferentPass1!');
    await page.getByRole('button', { name: 'Update password' }).click();

    await expect(page.getByText(/do not match/i)).toBeVisible();
  });

  test('successful password change shows success message and clears fields', async ({ page }) => {
    await mockProfileRoutes(page);
    await seedAuth(page);
    await page.goto('/profile');

    await page.getByRole('button', { name: 'Change password' }).click();
    await page.getByLabel('Current password').fill('OldPass1!');
    await page.getByLabel('New password', { exact: true }).fill('NewPass1!');
    await page.getByLabel('Confirm new password').fill('NewPass1!');
    await page.getByRole('button', { name: 'Update password' }).click();

    await expect(page.getByText('Password updated.')).toBeVisible();
    await expect(page.getByLabel('Current password')).toHaveValue('');
    await expect(page.getByLabel('New password', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Confirm new password')).toHaveValue('');
  });

  test('wrong current password: API 401 shows error message', async ({ page }) => {
    // Mock refresh so fetchWithAuth's 401 retry doesn't call clearSession
    await page.route('**/api/auth/refresh', (r) =>
      r.fulfill({ json: { accessToken: MOCK_ACCESS_TOKEN, refreshToken: MOCK_REFRESH_TOKEN } }),
    );
    await page.route('**/api/auth/mfa', (r) =>
      r.request().method() === 'GET'
        ? r.fulfill({ json: { enabled: false } })
        : r.fulfill({ status: 404, json: {} }),
    );
    await page.route('**/api/profile/me', (r) => r.fulfill({ json: MOCK_PROFILE }));
    await page.route('**/api/auth/password', (r) =>
      r.fulfill({ status: 401, json: { error: 'current password is incorrect' } }),
    );

    await seedAuth(page);
    await page.goto('/profile');

    await page.getByRole('button', { name: 'Change password' }).click();
    await page.getByLabel('Current password').fill('WrongPass1!');
    await page.getByLabel('New password', { exact: true }).fill('NewPass1!');
    await page.getByLabel('Confirm new password').fill('NewPass1!');
    await page.getByRole('button', { name: 'Update password' }).click();

    await expect(page.getByText(/current password is incorrect/i)).toBeVisible();
  });

  test('delete account: opens confirmation modal on button click', async ({ page }) => {
    await mockProfileRoutes(page);
    await seedAuth(page);
    await page.goto('/profile');

    await page.getByRole('button', { name: 'Delete account' }).click();
    await page.getByRole('button', { name: 'Delete my account' }).click();

    await expect(page.getByRole('heading', { name: 'Delete account' })).toBeVisible();
    await expect(page.getByPlaceholder('••••••••')).toBeVisible();
  });

  test('delete account: wrong password shows error in modal', async ({ page }) => {
    // Mock refresh so fetchWithAuth's 401 retry doesn't call clearSession
    await page.route('**/api/auth/refresh', (r) =>
      r.fulfill({ json: { accessToken: MOCK_ACCESS_TOKEN, refreshToken: MOCK_REFRESH_TOKEN } }),
    );
    await page.route('**/api/auth/mfa', (r) =>
      r.request().method() === 'GET'
        ? r.fulfill({ json: { enabled: false } })
        : r.fulfill({ status: 404, json: {} }),
    );
    await page.route('**/api/profile/me', (r) => r.fulfill({ json: MOCK_PROFILE }));
    await page.route('**/api/auth/account', (r) =>
      r.fulfill({ status: 401, json: { error: 'incorrect password' } }),
    );

    await seedAuth(page);
    await page.goto('/profile');

    await page.getByRole('button', { name: 'Delete account' }).click();
    await page.getByRole('button', { name: 'Delete my account' }).click();
    await page.getByPlaceholder('••••••••').fill('wrongpass');
    await page.getByRole('button', { name: 'Delete my account' }).last().click();

    await expect(page.getByText(/incorrect password/i)).toBeVisible();
  });

  test('delete account: success redirects to /login', async ({ page }) => {
    await page.route('**/api/auth/mfa', (r) =>
      r.request().method() === 'GET'
        ? r.fulfill({ json: { enabled: false } })
        : r.fulfill({ status: 404, json: {} }),
    );
    await page.route('**/api/profile/me', (r) => r.fulfill({ json: MOCK_PROFILE }));
    await page.route('**/api/auth/account', (r) =>
      r.fulfill({ json: { message: 'account deleted' } }),
    );
    await page.route('**/api/auth/logout', (r) => r.fulfill({ json: { message: 'logged out' } }));

    await seedAuth(page);
    await page.goto('/profile');

    await page.getByRole('button', { name: 'Delete account' }).click();
    await page.getByRole('button', { name: 'Delete my account' }).click();
    await page.getByPlaceholder('••••••••').fill('correctpass');
    await page.getByRole('button', { name: 'Delete my account' }).last().click();

    await page.waitForURL('/login');
    await expect(page).toHaveURL('/login');
  });
});

test.describe('MFA section (Profile tab)', () => {
  test('shows "Disabled" badge and "Set up MFA" button when MFA is off', async ({ page }) => {
    await mockProfileRoutes(page);
    await mockMFARoutes(page, { enabled: false });
    await seedAuth(page);
    await page.goto('/profile');

    await expect(page.getByText('Two-factor authentication')).toBeVisible();
    await expect(page.getByText('Disabled')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Set up MFA' })).toBeVisible();
  });

  test('shows "Enabled" badge and "Disable MFA" button when MFA is on', async ({ page }) => {
    await mockProfileRoutes(page);
    await mockMFARoutes(page, { enabled: true });
    await seedAuth(page);
    await page.goto('/profile');

    await expect(page.getByText('Enabled')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Disable MFA' })).toBeVisible();
  });

  test('clicking "Set up MFA" shows QR code section and secret', async ({ page }) => {
    await mockProfileRoutes(page);
    await mockMFARoutes(page, { enabled: false });
    await seedAuth(page);
    await page.goto('/profile');

    await page.getByRole('button', { name: 'Set up MFA' }).click();

    await expect(page.getByText('JBSWY3DPEHPK3PXP')).toBeVisible();
    await expect(page.getByPlaceholder('123456')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enable MFA' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  });

  test('"Enable MFA" button is disabled until 6 digits are entered', async ({ page }) => {
    await mockProfileRoutes(page);
    await mockMFARoutes(page, { enabled: false });
    await seedAuth(page);
    await page.goto('/profile');

    await page.getByRole('button', { name: 'Set up MFA' }).click();

    const enableBtn = page.getByRole('button', { name: 'Enable MFA' });
    await expect(enableBtn).toBeDisabled();
    await page.getByPlaceholder('123456').fill('12345');
    await expect(enableBtn).toBeDisabled();
    await page.getByPlaceholder('123456').fill('123456');
    await expect(enableBtn).toBeEnabled();
  });

  test('valid code enables MFA and shows "Enabled" state', async ({ page }) => {
    await mockProfileRoutes(page);
    await mockMFARoutes(page, { enabled: false });
    await seedAuth(page);
    await page.goto('/profile');

    await page.getByRole('button', { name: 'Set up MFA' }).click();
    await page.getByPlaceholder('123456').fill('654321');
    await page.getByRole('button', { name: 'Enable MFA' }).click();

    await expect(page.getByText('Enabled')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Disable MFA' })).toBeVisible();
  });

  test('invalid code shows error and stays on setup step', async ({ page }) => {
    await mockProfileRoutes(page);
    await mockMFARoutes(page, { enabled: false, enableError: 'invalid TOTP code' });
    await seedAuth(page);
    await page.goto('/profile');

    await page.getByRole('button', { name: 'Set up MFA' }).click();
    await page.getByPlaceholder('123456').fill('000000');
    await page.getByRole('button', { name: 'Enable MFA' }).click();

    await expect(page.getByText(/invalid totp code/i)).toBeVisible();
    await expect(page.getByPlaceholder('123456')).toBeVisible();
  });

  test('"Cancel" hides setup form and returns to disabled state', async ({ page }) => {
    await mockProfileRoutes(page);
    await mockMFARoutes(page, { enabled: false });
    await seedAuth(page);
    await page.goto('/profile');

    await page.getByRole('button', { name: 'Set up MFA' }).click();
    await expect(page.getByPlaceholder('123456')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByPlaceholder('123456')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Set up MFA' })).toBeVisible();
  });

  test('"Disable MFA" reverts to disabled state', async ({ page }) => {
    await mockProfileRoutes(page);
    await mockMFARoutes(page, { enabled: true });
    await seedAuth(page);
    await page.goto('/profile');

    await page.getByRole('button', { name: 'Disable MFA' }).click();

    await expect(page.getByText('Disabled')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Set up MFA' })).toBeVisible();
  });

  test('disable MFA failure shows error', async ({ page }) => {
    await mockProfileRoutes(page);
    await mockMFARoutes(page, { enabled: true, disableError: true });
    await seedAuth(page);
    await page.goto('/profile');

    await page.getByRole('button', { name: 'Disable MFA' }).click();

    await expect(page.getByText(/failed to disable mfa/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Disable MFA' })).toBeVisible();
  });
});
