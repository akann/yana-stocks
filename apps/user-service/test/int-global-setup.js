'use strict';
const { execSync } = require('node:child_process');
const { resolve } = require('node:path');
const dotenv = require('dotenv');

module.exports = async function globalSetup() {
  dotenv.config({ path: resolve(__dirname, '../.env.test') });
  execSync('pnpm prisma migrate deploy', {
    cwd: resolve(__dirname, '..'),
    env: { ...process.env },
    stdio: 'inherit',
  });
};
