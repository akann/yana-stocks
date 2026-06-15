import type { FullConfig } from '@playwright/test';

export default async function globalSetup(_config: FullConfig): Promise<void> {
  // API layer is mocked per-test via page.route(); no shared infrastructure needed.
}
