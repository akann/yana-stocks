import type { Page, Locator } from '@playwright/test';

export class HomePage {
  readonly page: Page;
  readonly searchInput: Locator;
  readonly searchButton: Locator;
  readonly moversSection: Locator;

  constructor(page: Page) {
    this.page = page;
    this.searchInput = page.locator('input[placeholder*="Search symbol"]');
    this.searchButton = page.locator('button[type="submit"]');
    this.moversSection = page.locator('text=Top Movers').first();
  }

  async goto() {
    await this.page.goto('/');
  }

  async searchSymbol(symbol: string) {
    await this.searchInput.fill(symbol);
    await this.searchButton.click();
  }
}
