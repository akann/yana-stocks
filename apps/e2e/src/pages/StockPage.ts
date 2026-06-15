import type { Locator, Page } from '@playwright/test';

export class StockPage {
  constructor(private readonly page: Page) {}

  async goto(symbol: string) {
    await this.page.goto(`/stocks/${symbol}`);
  }

  symbolHeading(symbol: string): Locator {
    return this.page.getByRole('heading', { name: symbol, level: 1 });
  }

  priceDisplay(): Locator {
    return this.page.locator('.text-3xl.font-bold');
  }

  sentimentSection(): Locator {
    return this.page.getByText('Sentiment', { exact: false }).first();
  }

  sentimentLabel(label: string): Locator {
    return this.page.locator('.capitalize').filter({ hasText: label }).first();
  }

  sentimentHeadline(text: string): Locator {
    return this.page.getByText(text, { exact: false });
  }

  predictionsSection(): Locator {
    return this.page.getByText('Predictions', { exact: false }).first();
  }

  predictionPrice(price: string): Locator {
    return this.page.getByText(price, { exact: true });
  }

  recentNewsSection(): Locator {
    return this.page.getByText('Recent News', { exact: false });
  }
}
