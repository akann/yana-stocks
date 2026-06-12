import type { Page, Locator } from '@playwright/test';

export class DashboardPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly totalValueCard: Locator;
  readonly portfoliosCountCard: Locator;
  readonly holdingsCard: Locator;
  readonly emptyState: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.locator('h1', { hasText: 'Dashboard' });
    this.totalValueCard = page.locator('p', { hasText: 'Total Portfolio Value' });
    this.portfoliosCountCard = page.locator('p', { hasText: 'Portfolios' }).first();
    this.holdingsCard = page.locator('p', { hasText: 'Holdings' });
    this.emptyState = page.locator('text=No portfolios yet');
  }

  async goto() {
    await this.page.goto('/dashboard');
  }

  portfolioSummaryCard(name: string): Locator {
    return this.page.locator('h3', { hasText: name });
  }
}
