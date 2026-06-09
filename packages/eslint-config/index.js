// @ts-check
const tseslint = require('typescript-eslint');

/** @type {import('typescript-eslint').Config} */
const base = tseslint.config(...tseslint.configs.recommendedTypeChecked, {
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-floating-promises': 'error',
  },
});

module.exports = { base };
