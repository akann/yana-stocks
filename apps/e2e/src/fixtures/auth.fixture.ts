import { test as base, type Page } from '@playwright/test';
import { MOCK_ACCESS_TOKEN, MOCK_REFRESH_TOKEN } from './data';

type AuthFixtures = {
  authedPage: Page;
};

/**
 * Extends the base Playwright test with an `authedPage` fixture.
 * The page has access_token + refresh_token pre-injected into localStorage,
 * matching what AuthContext reads on mount. Each test using this fixture must
 * still navigate to the page it wants to test.
 */
export const test = base.extend<AuthFixtures>({
  authedPage: async ({ page }, use) => {
    // Navigate to the app's origin so localStorage writes land on the right scope.
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(
      ({ at, rt }) => {
        localStorage.setItem('access_token', at);
        localStorage.setItem('refresh_token', rt);
      },
      { at: MOCK_ACCESS_TOKEN, rt: MOCK_REFRESH_TOKEN },
    );
    await use(page);
  },
});

export { expect } from '@playwright/test';
