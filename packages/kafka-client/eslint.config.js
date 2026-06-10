// @ts-check
const { base } = require('@yana-stocks/eslint-config');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config({ ignores: ['dist/**'] }, ...base, {
  languageOptions: {
    parserOptions: {
      project: './tsconfig.json',
      tsconfigRootDir: __dirname,
    },
  },
});
