import { defineConfig } from '@playwright/test';

/**
 * Playwright config for KxAI Electron E2E tests.
 *
 * Usage:
 *   npm run test:e2e          # build + run all E2E tests
 *   npx playwright test --config=e2e/playwright.config.ts   # run without rebuild
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',

  /* Timeout per test — Electron launch is slow */
  timeout: 60_000,

  /* Expect timeout */
  expect: { timeout: 10_000 },

  /* No retries in dev; CI can override via --retries=1 */
  retries: 0,

  /* Sequential — Electron tests share screen/display resources */
  workers: 1,

  /* Reporter */
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../test-results/e2e-html' }]],

  /* Output for traces/screenshots */
  outputDir: '../test-results/e2e-artifacts',

  /* No browser projects — we use Electron via _electron.launch() */
  projects: [],

  /* Global setup: ensure build is fresh (handled by npm script) */
});
