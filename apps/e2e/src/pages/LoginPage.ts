import type { Locator, Page } from '@playwright/test';

export class LoginPage {
  readonly continueButton: Locator;
  readonly registerLink: Locator;

  constructor(private readonly page: Page) {
    this.continueButton = page.getByRole('button', { name: /continue with authentik/i });
    this.registerLink = page.getByRole('link', { name: 'Get started' });
  }

  async goto() {
    await this.page.goto('/login');
  }
}
