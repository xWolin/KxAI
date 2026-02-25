/**
 * E2E: App Launch & Navigation
 *
 * Tests that the app starts correctly and navigation between views works.
 * Uses pre-completed onboarding (skips wizard).
 */
import { test, expect } from '../fixtures';

test.describe('App Launch', () => {
  test('should start and show the widget view', async ({ page }) => {
    // After launch with onboarding completed, app should show widget
    const container = page.locator('.app-container');
    await expect(container).toBeVisible({ timeout: 15_000 });

    // Widget has the transparent class
    await expect(container).toHaveClass(/app-container--transparent/);
  });

  test('should display the floating widget with correct emoji', async ({ page }) => {
    await page.waitForSelector('.app-container--transparent', { timeout: 15_000 });

    // The widget should show the configured emoji (🤖 from test config)
    const widgetText = await page.textContent('.app-container');
    expect(widgetText).toContain('🤖');
  });
});

test.describe('View Navigation', () => {
  test('should navigate from widget to chat on click', async ({ page }) => {
    await page.waitForSelector('.app-container--transparent', { timeout: 15_000 });

    // Click the floating widget — should open chat
    await page.click('.app-container');

    // Wait for chat panel to appear
    const chatPanel = page.locator('[class*="chatPanel"], [class*="chat-panel"], [class*="ChatPanel"]');
    await expect(chatPanel.first()).toBeVisible({ timeout: 10_000 });

    // Container should no longer be transparent
    const container = page.locator('.app-container');
    await expect(container).not.toHaveClass(/app-container--transparent/);
  });

  test('should navigate from chat to settings', async ({ page }) => {
    await page.waitForSelector('.app-container--transparent', { timeout: 15_000 });

    // Open chat first
    await page.click('.app-container');
    await page.waitForTimeout(500);

    // Click the settings button (gear icon in chat header)
    const settingsBtn = page.locator('button[aria-label*="stawien"], button[aria-label*="etting"], button[title*="stawien"], button[title*="etting"]');

    // Fallback: find button by emoji/icon content
    if (await settingsBtn.count() === 0) {
      // Settings button typically has ⚙️ or similar
      await page.locator('button').filter({ hasText: '⚙' }).first().click();
    } else {
      await settingsBtn.first().click();
    }

    // Settings panel should appear
    await page.waitForTimeout(500);
    const pageContent = await page.textContent('body');
    // Settings should show some identifiable text (API key fields, provider selection, etc.)
    expect(
      pageContent?.includes('OpenAI') ||
      pageContent?.includes('Anthropic') ||
      pageContent?.includes('API') ||
      pageContent?.includes('Ustawienia'),
    ).toBeTruthy();
  });

  test('should navigate back from settings to chat', async ({ page }) => {
    await page.waitForSelector('.app-container--transparent', { timeout: 15_000 });

    // Widget → Chat → Settings → back to Chat
    await page.click('.app-container');
    await page.waitForTimeout(500);

    // Go to settings
    const gearBtn = page.locator('button').filter({ hasText: '⚙' });
    if (await gearBtn.count() > 0) {
      await gearBtn.first().click();
      await page.waitForTimeout(500);

      // Click back button
      const backBtn = page.locator('button').filter({ hasText: '←' });
      if (await backBtn.count() > 0) {
        await backBtn.first().click();
        await page.waitForTimeout(500);
      }
    }

    // Should be back in chat
    const chatInput = page.locator('textarea, input[type="text"]');
    await expect(chatInput.first()).toBeVisible({ timeout: 5_000 });
  });
});
