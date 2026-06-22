import { test as base, type Page } from '@playwright/test';
import { MOCK_ACCESS_TOKEN, MOCK_REFRESH_TOKEN } from './data';

type AuthFixtures = {
  authedPage: Page;
};

/**
 * Extends the base Playwright test with an `authedPage` fixture.
 * Tokens are written into sessionStorage (matching AuthContext reads on mount).
 * Each test using this fixture must navigate to the page it wants to test.
 */
const MOCK_USER = { userId: 'user-1', email: 'user@example.com' };
const MOCK_PROFILE_DATA = {
  userId: 'user-1',
  displayName: 'Test User',
  avatar: '',
  bio: '',
  preferences: { theme: 'dark', defaultCurrency: 'USD', emailNotifications: true },
};

export const test = base.extend<AuthFixtures>({
  authedPage: async ({ page }, use) => {
    // Inject tokens before any page scripts run so AuthContext.useEffect always finds them
    await page.addInitScript(
      ({ at, rt }: { at: string; rt: string }) => {
        sessionStorage.setItem('access_token', at);
        sessionStorage.setItem('refresh_token', rt);
      },
      { at: MOCK_ACCESS_TOKEN, rt: MOCK_REFRESH_TOKEN },
    );
    // Register route interceptors (await ensures WebKit acknowledges them before navigation)
    await page.route('**/api/auth/me', (r) => r.fulfill({ json: MOCK_USER }));
    await page.route('**/api/profile/me', (r) => r.fulfill({ json: MOCK_PROFILE_DATA }));
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await use(page);
  },
});

export { expect } from '@playwright/test';
