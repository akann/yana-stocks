import type { Locator, Page } from '@playwright/test';

export class PortfolioPage {
  readonly heading: Locator;
  readonly newPortfolioButton: Locator;
  readonly portfolioNameInput: Locator;
  readonly createButton: Locator;
  readonly emptyState: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Portfolios', level: 1 });
    // Use .first() — the header button appears before the identical empty-state button.
    this.newPortfolioButton = page.getByRole('button', { name: '+ New Portfolio' }).first();
    this.portfolioNameInput = page.getByPlaceholder('e.g. Tech Growth');
    this.createButton = page.getByRole('button', { name: /^create$/i });
    this.emptyState = page.getByText('No portfolios yet');
  }

  async goto() {
    await this.page.goto('/portfolio');
  }

  portfolioHeading(name: string): Locator {
    return this.page.locator('h3').filter({ hasText: name });
  }

  deleteButton(): Locator {
    return this.page.locator('button[title="Delete portfolio"]');
  }

  confirmDeleteButton(): Locator {
    return this.page.getByRole('button', { name: 'Yes' });
  }

  addStockLink(): Locator {
    return this.page.getByText('+ Add Stock');
  }

  stockRow(symbol: string): Locator {
    return this.page.locator('td').filter({ hasText: symbol }).first();
  }

  // AddStockModal elements
  stockSymbolInput(): Locator {
    return this.page.getByPlaceholder('AAPL');
  }

  stockSharesInput(): Locator {
    return this.page.getByPlaceholder('10');
  }

  stockPriceInput(): Locator {
    return this.page.getByPlaceholder('150.00');
  }

  addStockSubmitButton(): Locator {
    return this.page.getByRole('button', { name: /^add stock$/i });
  }
}
