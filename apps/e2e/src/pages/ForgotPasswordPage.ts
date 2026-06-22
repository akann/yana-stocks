import type { Locator, Page } from '@playwright/test';

export class ForgotPasswordPage {
  readonly emailInput: Locator;
  readonly submitButton: Locator;
  readonly backToSignInLink: Locator;

  constructor(private readonly page: Page) {
    this.emailInput = page.locator('input[type="email"]');
    this.submitButton = page.getByRole('button', { name: /send reset link/i });
    this.backToSignInLink = page.getByRole('link', { name: /back to sign in/i });
  }

  async goto() {
    await this.page.goto('/forgot-password');
  }

  async submit(email: string) {
    await this.emailInput.fill(email);
    await this.submitButton.click();
  }
}
