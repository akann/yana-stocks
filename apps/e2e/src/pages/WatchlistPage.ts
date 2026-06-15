import type { Locator, Page } from '@playwright/test';

export class WatchlistPage {
  readonly heading: Locator;
  readonly newWatchlistButton: Locator;
  readonly watchlistNameInput: Locator;
  readonly createButton: Locator;
  readonly emptyState: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Watchlists', level: 1 });
    this.newWatchlistButton = page.getByRole('button', { name: '+ New Watchlist' });
    this.watchlistNameInput = page.getByPlaceholder('e.g. AI Stocks');
    this.createButton = page.getByRole('button', { name: /^create$/i });
    this.emptyState = page.getByText('No watchlists yet');
  }

  async goto() {
    await this.page.goto('/watchlist');
  }

  watchlistHeading(name: string): Locator {
    return this.page.locator('h3').filter({ hasText: name });
  }

  deleteButton(): Locator {
    return this.page.locator('button[title="Delete watchlist"]');
  }

  confirmDeleteButton(): Locator {
    return this.page.getByRole('button', { name: 'Yes' });
  }

  addSymbolButton(): Locator {
    return this.page.getByText('+ Add Symbol');
  }

  symbolInput(): Locator {
    return this.page.getByPlaceholder('Symbol (e.g. AAPL)');
  }

  addSubmitButton(): Locator {
    return this.page.getByRole('button', { name: 'Add' });
  }

  removeSymbolButton(symbol: string): Locator {
    return this.page.locator(`button[title="Remove ${symbol}"]`);
  }

  symbolCell(symbol: string): Locator {
    return this.page.locator('td').filter({ hasText: symbol }).first();
  }
}
