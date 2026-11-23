import { defineConfig, devices } from '@playwright/test';

/**
 * E2E suite (spec §19). Requires the local stack: Postgres (migrated+seeded),
 * API on :4000, web on :3000. In CI the workflow starts both servers after a
 * fresh migrate+seed; locally the same commands as the README apply.
 */
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  timeout: 45_000,
  retries: 0,
  workers: 1, // shared demo DB — serial keeps assertions predictable
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
