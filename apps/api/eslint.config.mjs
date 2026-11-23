import base from '@quickcart/config/eslint/base';

export default [
  ...base,
  {
    ignores: ['dist/**', 'src/generated/**'],
  },
  {
    files: ['src/**/*.ts', 'prisma/**/*.ts'],
    rules: {
      // Nest's DI reads constructor parameter types from emitted decorator
      // metadata; type-only rewriting of injected imports breaks resolution.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    // Seed and other prisma-facing scripts are CLI tools; console output is
    // their primary interface.
    files: ['prisma/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
];
