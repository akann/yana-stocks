import type { Locator, Page } from '@playwright/test';

export class HomePage {
  readonly symbolInput: Locator;
  readonly searchButton: Locator;
  readonly topGainersHeading: Locator;
  readonly topLosersHeading: Locator;

  constructor(private readonly page: Page) {
    this.symbolInput = page.getByPlaceholder(/search symbol/i);
    this.searchButton = page.getByRole('button', { name: /^go$/i });
    this.topGainersHeading = page.getByText('Top Gainers');
    this.topLosersHeading = page.getByText('Top Losers');
  }

  async goto() {
    await this.page.goto('/');
  }

  async searchSymbol(symbol: string) {
    // pressSequentially fires individual key events, guaranteeing React's onChange
    // processes each character before the submit click — fill() can race with
    // React state commits on WebKit.
    await this.symbolInput.clear();
    await this.symbolInput.pressSequentially(symbol);
    await this.searchButton.click();
  }
}
