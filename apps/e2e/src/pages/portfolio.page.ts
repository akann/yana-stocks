import type { Page, Locator } from '@playwright/test';

export class PortfolioPage {
  readonly page: Page;
  readonly newPortfolioButton: Locator;
  readonly portfolioNameInput: Locator;
  readonly createButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.newPortfolioButton = page.locator('button', { hasText: 'New Portfolio' });
    this.portfolioNameInput = page.locator('input[placeholder="Portfolio name"]');
    this.createButton = page.locator('button', { hasText: 'Create' }).last();
  }

  async goto() {
    await this.page.goto('/portfolio');
  }

  async createPortfolio(name: string) {
    await this.newPortfolioButton.click();
    await this.portfolioNameInput.fill(name);
    await this.createButton.click();
  }

  async openAddStock(portfolioName: string) {
    const row = this.page.locator('h3', { hasText: portfolioName });
    const card = row.locator('..').locator('..').locator('..');
    await card.locator('button', { hasText: '+ Add Stock' }).click();
  }

  async addStock(symbol: string, shares: string, price: string) {
    await this.page.locator('input[placeholder="AAPL"]').fill(symbol);
    await this.page.locator('input[placeholder="10"]').fill(shares);
    await this.page.locator('input[placeholder="150.00"]').fill(price);
    await this.page.getByRole('button', { name: 'Add Stock', exact: true }).click();
  }

  portfolioCard(name: string): Locator {
    return this.page.locator('h3', { hasText: name }).locator('../..');
  }
}
