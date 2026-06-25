import type { Page, Locator } from '@playwright/test';

export class StockPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // The lightweight-charts canvas element inside the chart container
  get canvas(): Locator {
    return this.page.locator('canvas').first();
  }

  async goto(symbol: string): Promise<void> {
    await this.page.goto(`/stocks/${symbol}`);
  }

  async clickRange(label: string): Promise<void> {
    await this.page.getByRole('button', { name: label, exact: true }).click();
    // Wait for the clicked button to reflect the active state (bg-blue-600)
    await this.page.locator(`button:has-text("${label}").bg-blue-600`).waitFor({ timeout: 5_000 });
  }

  // Waits for the page to settle after navigation: auth resolves, initial queries complete.
  async waitForLoad(): Promise<void> {
    await this.page.waitForLoadState('networkidle', { timeout: 15_000 });
    await this.canvas.waitFor({ state: 'visible', timeout: 10_000 });
  }

  // Returns true if any chart canvas contains pixels that differ from the background
  // (#f2f5f7 = rgb 242,245,247). A blank chart (no data rendered) contains only
  // background-color pixels; a painted chart will have grid lines, candles, or area fills.
  async hasChartContent(): Promise<boolean> {
    return this.page.evaluate(() => {
      const canvases = Array.from(document.querySelectorAll('canvas'));
      const bgR = 242,
        bgG = 245,
        bgB = 247;
      return canvases.some((canvas) => {
        const ctx = canvas.getContext('2d');
        if (!ctx) return false;
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < data.length; i += 4) {
          if (
            Math.abs(data[i]! - bgR) > 10 ||
            Math.abs(data[i + 1]! - bgG) > 10 ||
            Math.abs(data[i + 2]! - bgB) > 10
          ) {
            return true;
          }
        }
        return false;
      });
    });
  }
}
