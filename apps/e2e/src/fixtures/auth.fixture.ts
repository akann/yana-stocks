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
export const test = base.extend<AuthFixtures>({
  authedPage: async ({ page }, use) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(
      ({ at, rt }) => {
        sessionStorage.setItem('access_token', at);
        sessionStorage.setItem('refresh_token', rt);
      },
      { at: MOCK_ACCESS_TOKEN, rt: MOCK_REFRESH_TOKEN },
    );
    await use(page);
  },
});

export { expect } from '@playwright/test';
