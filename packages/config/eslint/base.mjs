// Base ESLint (flat config) shared by all QuickCart packages.
// Consumer usage:
//   import base from '@quickcart/config/eslint/base';
//   export default [...base, { /* app-specific rules */ }];
import { defineConfig, globalIgnores } from 'eslint/config';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default defineConfig(
  {
    ignores: ['dist/**', 'generated/**', 'node_modules/**', '.next/**', '.turbo/**', 'coverage/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
    },
  },
  eslintConfigPrettier,
);
