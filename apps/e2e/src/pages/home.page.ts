import type { Page, Locator } from '@playwright/test';

export class HomePage {
  readonly page: Page;
  readonly searchInput: Locator;
  readonly searchButton: Locator;
  readonly gainersSection: Locator;
  readonly losersSection: Locator;
  readonly stockBrowserSection: Locator;
  readonly stockBrowserSearch: Locator;
  readonly stockBrowserTable: Locator;

  constructor(page: Page) {
    this.page = page;
    this.searchInput = page.locator('input[placeholder*="Search symbol"]');
    this.searchButton = page.locator('button[type="submit"]');
    this.gainersSection = page.locator('h3', { hasText: 'Top Gainers' });
    this.losersSection = page.locator('h3', { hasText: 'Top Losers' });
    this.stockBrowserSection = page.locator('h2', { hasText: 'All Stocks' });
    this.stockBrowserSearch = page.locator('input[placeholder*="Search by symbol"]');
    this.stockBrowserTable = page
      .locator('h2', { hasText: 'All Stocks' })
      .locator('../..')
      .locator('table');
  }

  firstGainerLink(): Locator {
    return this.gainersSection.locator('../..').locator('a').first();
  }

  firstLoserLink(): Locator {
    return this.losersSection.locator('../..').locator('a').first();
  }

  gainerLinks(): Locator {
    return this.gainersSection.locator('..').locator('a');
  }

  loserLinks(): Locator {
    return this.losersSection.locator('..').locator('a');
  }

  async goto() {
    await this.page.goto('/');
  }

  async searchSymbol(symbol: string) {
    await this.searchInput.fill(symbol);
    await this.searchButton.click();
  }
}
