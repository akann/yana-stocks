import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './src/tests',
  globalSetup: './src/global-setup.ts',
  fullyParallel: false,
  retries: process.env['CI'] ? 2 : 1,
  workers: 1,
  timeout: 60_000,
  reporter: [['html', { open: 'never' }]],
  webServer: {
    command: 'pnpm --filter @yana-stocks/frontend dev',
    url: 'http://localhost:3000/login',
    reuseExistingServer: true,
    timeout: 60_000,
    cwd: '../..',
    // See src/app/page.tsx — skips the homepage's server-side data prefetch,
    // which page.route() mocks below can't intercept. CI starts the frontend
    // itself (not via this webServer block, since reuseExistingServer finds
    // it already running) and sets this same var in .github/workflows/ci.yml.
    env: { E2E_TEST_MODE: 'true' },
  },
  use: {
    baseURL: process.env['BASE_URL'] ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    navigationTimeout: 30_000,
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 14'] },
    },
  ],
});
