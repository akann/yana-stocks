import type { Locator, Page } from '@playwright/test';

export class ResetPasswordPage {
  readonly newPasswordInput: Locator;
  readonly confirmPasswordInput: Locator;
  readonly submitButton: Locator;

  constructor(private readonly page: Page) {
    this.newPasswordInput = page.getByLabel('New password');
    this.confirmPasswordInput = page.getByLabel('Confirm password');
    this.submitButton = page.getByRole('button', { name: /reset password/i });
  }

  async goto(token: string) {
    await this.page.goto(`/reset-password?token=${token}`);
  }

  async reset(newPassword: string) {
    await this.newPasswordInput.fill(newPassword);
    await this.confirmPasswordInput.fill(newPassword);
    await this.submitButton.click();
  }
}
