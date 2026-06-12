import type { Page, Locator } from '@playwright/test';

export class StockPage {
  readonly page: Page;
  readonly priceChart: Locator;
  readonly sentimentPanel: Locator;
  readonly predictionsPanel: Locator;
  readonly sentimentLabel: Locator;
  readonly sentimentHeadline: Locator;

  constructor(page: Page) {
    this.page = page;
    this.priceChart = page
      .locator('h3', { hasText: 'Price History' })
      .or(page.getByText('No price history available'))
      .first();
    this.sentimentPanel = page.getByRole('heading', { name: 'Sentiment', exact: true });
    this.predictionsPanel = page.getByRole('heading', { name: 'Predictions', exact: true });
    this.sentimentLabel = page.locator('span.capitalize').filter({
      hasText: /^(positive|negative|neutral)$/i,
    });
    this.sentimentHeadline = page.locator('p.text-gray-300');
  }

  predictionCard(horizon: string): Locator {
    return this.page.locator('div.bg-gray-800.rounded-lg').filter({ hasText: horizon });
  }

  async goto(symbol: string) {
    await this.page.goto(`/stocks/${symbol}`);
  }

  symbolHeading(): Locator {
    return this.page.locator('h1');
  }
}
