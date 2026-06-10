import type { Page, Locator } from '@playwright/test';

export class StockPage {
  readonly page: Page;
  readonly priceChart: Locator;
  readonly sentimentPanel: Locator;
  readonly predictionsPanel: Locator;

  constructor(page: Page) {
    this.page = page;
    this.priceChart = page.locator('text=Price History');
    this.sentimentPanel = page.locator('text=Sentiment');
    this.predictionsPanel = page.locator('text=Predictions');
  }

  async goto(symbol: string) {
    await this.page.goto(`/stocks/${symbol}`);
  }

  symbolHeading(): Locator {
    return this.page.locator('h1');
  }
}
