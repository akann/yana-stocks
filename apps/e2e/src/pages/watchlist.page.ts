import type { Page, Locator } from '@playwright/test';

export class WatchlistPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly newWatchlistButton: Locator;
  readonly watchlistNameInput: Locator;
  readonly createButton: Locator;
  readonly emptyState: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.locator('h1', { hasText: 'Watchlists' });
    this.newWatchlistButton = page.locator('button', { hasText: 'New Watchlist' });
    this.watchlistNameInput = page.locator('input[placeholder="Watchlist name"]');
    this.createButton = page.locator('button[type="submit"]', { hasText: 'Create' });
    this.emptyState = page.locator('text=No watchlists yet');
  }

  async goto() {
    await this.page.goto('/watchlist');
  }

  async createWatchlist(name: string) {
    await this.newWatchlistButton.click();
    await this.watchlistNameInput.fill(name);
    await this.createButton.click();
  }

  watchlistCard(name: string): Locator {
    return this.page.locator('h3', { hasText: name }).locator('../..');
  }

  async openAddSymbol(watchlistName: string) {
    await this.watchlistCard(watchlistName).locator('button', { hasText: '+ Add' }).click();
  }

  async addSymbol(symbol: string) {
    await this.page.locator('input[placeholder="Symbol (e.g. AAPL)"]').fill(symbol);
    await this.page.locator('button[type="submit"]', { hasText: 'Add' }).click();
  }
}
