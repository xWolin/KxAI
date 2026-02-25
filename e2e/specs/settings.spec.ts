/**
 * E2E: Settings Panel
 *
 * Tests that settings panel renders correctly with all tabs and fields.
 */
import { test, expect } from '../fixtures';

/** Helper: navigate to settings from widget */
async function openSettings(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForSelector('.app-container--transparent', { timeout: 15_000 });

  // Widget → Chat → Settings
  await page.click('.app-container');
  await page.waitForTimeout(500);

  // Find and click settings button (⚙️ icon)
  const gearBtn = page.locator('button').filter({ hasText: '⚙' });
  if (await gearBtn.count() > 0) {
    await gearBtn.first().click();
  } else {
    // Fallback: look for aria-label
    const settingsBtn = page.locator(
      'button[aria-label*="stawien"], button[aria-label*="etting"]',
    );
    await settingsBtn.first().click();
  }
  await page.waitForTimeout(500);
}

test.describe('Settings Panel', () => {
  test('should display settings with tabs', async ({ page }) => {
    await openSettings(page);

    // Settings should show tab navigation
    const tabs = page.locator('[role="tab"], [class*="tab"]');
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThanOrEqual(2);
  });

  test('should show AI provider configuration', async ({ page }) => {
    await openSettings(page);

    // Should contain provider-related text
    const bodyText = await page.textContent('body');
    expect(
      bodyText?.includes('OpenAI') || bodyText?.includes('Anthropic') || bodyText?.includes('AI'),
    ).toBeTruthy();
  });

  test('should show agent name in settings', async ({ page }) => {
    await openSettings(page);

    // The test config has agentName: 'TestBot'
    const bodyText = await page.textContent('body');
    // Agent name or emoji should be visible somewhere
    expect(bodyText?.includes('🤖') || bodyText?.includes('TestBot')).toBeTruthy();
  });

  test('should have a back button to return to chat', async ({ page }) => {
    await openSettings(page);

    // Find back button
    const backBtn = page.locator('button').filter({ hasText: /←|Wróć|Back/i });
    await expect(backBtn.first()).toBeVisible({ timeout: 5_000 });

    // Click back
    await backBtn.first().click();
    await page.waitForTimeout(500);

    // Should show chat (with textarea/input)
    const input = page.locator('textarea, input[type="text"]');
    await expect(input.first()).toBeVisible({ timeout: 5_000 });
  });

  test('should display language selector', async ({ page }) => {
    await openSettings(page);

    // Language selector should be present (🇵🇱 / 🇬🇧)
    const bodyText = await page.textContent('body');
    expect(
      bodyText?.includes('🇵🇱') ||
      bodyText?.includes('🇬🇧') ||
      bodyText?.includes('Polski') ||
      bodyText?.includes('English') ||
      bodyText?.includes('Język') ||
      bodyText?.includes('Language'),
    ).toBeTruthy();
  });
});
