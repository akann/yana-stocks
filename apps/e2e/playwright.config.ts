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
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 60_000,
    cwd: '../..',
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
