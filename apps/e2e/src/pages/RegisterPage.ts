import type { Locator, Page } from '@playwright/test';

export class RegisterPage {
  readonly emailInput: Locator;
  readonly nameInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly error: Locator;
  readonly signInLink: Locator;

  constructor(private readonly page: Page) {
    this.emailInput = page.locator('input[type="email"]');
    this.nameInput = page.locator('input[type="text"]');
    this.passwordInput = page.locator('input[type="password"]');
    this.submitButton = page.getByRole('button', { name: /create account/i });
    this.error = page.getByText(/registration failed|email already registered/i);
    this.signInLink = page
      .getByText('Already have an account?')
      .getByRole('link', { name: 'Sign in' });
  }

  async goto() {
    await this.page.goto('/register');
  }

  async register(email: string, password: string, name?: string) {
    await this.emailInput.fill(email);
    if (name) await this.nameInput.fill(name);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }
}
