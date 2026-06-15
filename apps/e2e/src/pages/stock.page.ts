import type { Page, Locator } from '@playwright/test';

export class StockPage {
  readonly page: Page;
  readonly priceChart: Locator;
  readonly sentimentPanel: Locator;
  readonly predictionsPanel: Locator;
  readonly sentimentLabel: Locator;
  readonly sentimentHeadline: Locator;
  readonly newsPanel: Locator;
  readonly newsArticleList: Locator;

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
    this.newsPanel = page.locator('h3', { hasText: 'Recent News' });
    this.newsArticleList = page
      .locator('h3', { hasText: 'Recent News' })
      .locator('..')
      .locator('ul');
  }

  predictionCard(horizon: string): Locator {
    return this.page.locator('div.bg-gray-800.rounded-lg').filter({ hasText: horizon });
  }

  newsArticle(index: number): Locator {
    return this.newsArticleList.locator('li').nth(index);
  }

  async goto(symbol: string) {
    await this.page.goto(`/stocks/${symbol}`);
  }

  symbolHeading(): Locator {
    return this.page.locator('h1');
  }
}
