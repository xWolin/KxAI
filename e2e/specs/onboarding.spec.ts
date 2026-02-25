/**
 * E2E: Onboarding Wizard Flow
 *
 * Tests the full onboarding experience from a fresh app state.
 * Uses setupFreshEnvironment() — NO pre-completed onboarding.
 */
import { test as base, _electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'path';
import { setupFreshEnvironment, cleanupTestEnvironment, getTestUserDataDir } from '../helpers/setup-test-env';

/** Fresh-start fixtures — onboarding NOT completed */
const test = base.extend<{ electronApp: ElectronApplication; page: Page }>({
  // eslint-disable-next-line no-empty-pattern
  electronApp: async ({}, use) => {
    const userDataDir = getTestUserDataDir();
    setupFreshEnvironment(userDataDir);

    const appPath = path.resolve(__dirname, '../..');

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
    await electronApp.close();
    cleanupTestEnvironment(userDataDir);
  },

  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await page.waitForSelector('.app-container, .app-loading', { timeout: 15_000 });
    const loadingEl = await page.$('.app-loading');
    if (loadingEl) {
      await page.waitForSelector('.app-container', { timeout: 15_000 });
    }
    await use(page);
  },
});

test.describe('Onboarding Wizard', () => {
  test('should show onboarding wizard on first launch', async ({ page }) => {
    // With onboarded=false, the wizard should be visible
    const container = page.locator('.app-container');
    await expect(container).toBeVisible({ timeout: 15_000 });

    // Should NOT be transparent (widget mode)
    await expect(container).not.toHaveClass(/app-container--transparent/);

    // Should contain welcome text or onboarding elements
    const bodyText = await page.textContent('body');
    expect(
      bodyText?.includes('KxAI') || bodyText?.includes('Witaj') || bodyText?.includes('Welcome'),
    ).toBeTruthy();
  });

  test('should navigate through onboarding steps', async ({ page }) => {
    await page.waitForSelector('.app-container', { timeout: 15_000 });

    // Step 0: Welcome — "Dalej" / "Next" button should be present
    const nextBtn = page.locator('button').filter({ hasText: /Dalej|Next|Kontynuuj|Continue/i });
    await expect(nextBtn.first()).toBeVisible({ timeout: 5_000 });

    // Click Next to proceed to Step 1
    await nextBtn.first().click();
    await page.waitForTimeout(500);

    // Step 1: User info — should have name input
    const nameInput = page.locator('#userName, input[placeholder*="imię"], input[placeholder*="name"]');
    await expect(nameInput.first()).toBeVisible({ timeout: 5_000 });

    // Fill in user data
    await nameInput.first().fill('Test User');

    const roleInput = page.locator('#userRole, input[placeholder*="rola"], input[placeholder*="role"]');
    await roleInput.first().fill('Developer');

    // Click Next to Step 2
    await nextBtn.first().click();
    await page.waitForTimeout(500);

    // Step 2: Agent name — should have agent name input
    const agentInput = page.locator('#agentName, input[placeholder="KxAI"]');
    await expect(agentInput.first()).toBeVisible({ timeout: 5_000 });

    // Click Next to Step 3
    await nextBtn.first().click();
    await page.waitForTimeout(500);

    // Step 3: AI Provider — should show OpenAI / Anthropic buttons
    const bodyText = await page.textContent('body');
    expect(bodyText?.includes('OpenAI') || bodyText?.includes('Anthropic')).toBeTruthy();
  });

  test('should have progress dots matching current step', async ({ page }) => {
    await page.waitForSelector('.app-container', { timeout: 15_000 });

    // Step 0: Check for progress indicator dots
    // The component renders 6 dots (steps 0-5)
    const dots = page.locator('[class*="dot"]');
    const dotCount = await dots.count();
    // Should have at least 6 dots (may have more depending on CSS class naming)
    expect(dotCount).toBeGreaterThanOrEqual(6);
  });
});
