// ESLint (flat config) preset for Next.js apps.
// Extends the base preset with browser globals awareness.
import base from './base.mjs';

export default [
  ...base,
  {
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
        process: 'readonly',
        FormData: 'readonly',
        alert: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
];
