import type { Page, Locator } from '@playwright/test';

export class StockPage {
  readonly page: Page;
  readonly priceChart: Locator;
  readonly sentimentPanel: Locator;
  readonly predictionsPanel: Locator;

  constructor(page: Page) {
    this.page = page;
    this.priceChart = page.locator('h3', { hasText: 'Price History' }).or(page.getByText('No price history available')).first();
    this.sentimentPanel = page.getByRole('heading', { name: 'Sentiment', exact: true });
    this.predictionsPanel = page.getByRole('heading', { name: 'Predictions', exact: true });
  }

  async goto(symbol: string) {
    await this.page.goto(`/stocks/${symbol}`);
  }

  symbolHeading(): Locator {
    return this.page.locator('h1');
  }
}
