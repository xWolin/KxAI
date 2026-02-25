/**
 * KxAI E2E Test Fixtures — Playwright + Electron
 *
 * Provides `electronApp` and `page` fixtures for all E2E specs.
 * Handles app launch, onboarding bypass, and cleanup.
 */
import { test as base, _electron, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { setupTestEnvironment, cleanupTestEnvironment, getTestUserDataDir } from './helpers/setup-test-env';

/** Extended test fixtures for Electron E2E */
type KxAIFixtures = {
  electronApp: ElectronApplication;
  page: Page;
};

/**
 * Test fixture that launches the Electron app with a clean test environment.
 * By default, onboarding is pre-completed so tests start at the widget view.
 */
export const test = base.extend<KxAIFixtures>({
  // eslint-disable-next-line no-empty-pattern
  electronApp: async ({}, use) => {
    const userDataDir = getTestUserDataDir();
    setupTestEnvironment(userDataDir);

    const appPath = path.resolve(__dirname, '..');

    const electronApp = await _electron.launch({
      args: [appPath],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        KXAI_USER_DATA: userDataDir,
        ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      },
    });

    await use(electronApp);

    // Cleanup
    await electronApp.close();
    cleanupTestEnvironment(userDataDir);
  },

  page: async ({ electronApp }, use) => {
    // Wait for the first BrowserWindow
    const page = await electronApp.firstWindow();

    // Wait for the app to finish loading (isLoading → false)
    await page.waitForSelector('.app-container, .app-loading', { timeout: 15_000 });

    // If loading spinner is visible, wait for it to disappear
    const loadingEl = await page.$('.app-loading');
    if (loadingEl) {
      await page.waitForSelector('.app-container', { timeout: 15_000 });
    }

    await use(page);
  },
});

export { expect } from '@playwright/test';
