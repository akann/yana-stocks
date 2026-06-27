const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: __dirname });

/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    // Preserve next/jest's tsconfig path alias
    '^@/(.*)$': '<rootDir>/src/$1',
    // lightweight-charts is ESM-only; point Jest at the manual CJS mock
    '^lightweight-charts$': '<rootDir>/src/__mocks__/lightweight-charts.js',
  },
};

module.exports = createJestConfig(config);
