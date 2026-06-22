import type { Locator, Page } from '@playwright/test';

export class LoginPage {
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly registerLink: Locator;
  readonly forgotPasswordLink: Locator;

  // TOTP step — visible after credentials succeed for MFA-enabled accounts
  readonly totpInput: Locator;
  readonly totpSubmitButton: Locator;
  readonly totpHeading: Locator;

  constructor(private readonly page: Page) {
    this.emailInput = page.locator('input[type="email"]');
    this.passwordInput = page.locator('input[type="password"]');
    this.submitButton = page.getByRole('button', { name: /sign in/i });
    this.registerLink = page.getByRole('link', { name: 'Register' });
    this.forgotPasswordLink = page.getByRole('link', { name: /forgot password/i });

    this.totpInput = page.locator('input[autocomplete="one-time-code"]');
    this.totpSubmitButton = page.getByRole('button', { name: /verify/i });
    this.totpHeading = page.getByRole('heading', { name: /two.factor/i });
  }

  async goto() {
    await this.page.goto('/login');
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  async submitTOTP(code: string) {
    await this.totpInput.fill(code);
    await this.totpSubmitButton.click();
  }
}
