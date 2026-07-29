import { defineConfig, devices } from '@playwright/test';

/**
 * E2E suite (docs/testing-strategy.md). Runs against `next dev` with local
 * Cloudflare bindings (Miniflare D1 — never remote data). Local D1 migrations
 * are applied by the `e2e` script before Playwright starts.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  // Dev-server cold compiles make first hits slow; assertions wait generously.
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  // Sequential: specs share one dev server and one local D1.
  workers: 1,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
      : {}),
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
