import { execSync } from 'child_process';
import * as path from 'path';

async function globalSetup(): Promise<void> {
  const repoRoot = path.resolve(__dirname, '../../..');
  try {
    console.log('\n[global-setup] Seeding Redis with dev data...');
    execSync('pnpm --filter @yana-stocks/portfolio-api seed', {
      cwd: repoRoot,
      stdio: 'inherit',
    });
  } catch {
    console.warn('[global-setup] Seed script failed — market/stock data tests may fail');
  }
}

export default globalSetup;
