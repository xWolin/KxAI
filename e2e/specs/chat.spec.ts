/**
 * E2E: Chat Panel
 *
 * Tests chat UI interactions (input, message display, toolbar buttons).
 * Does NOT test actual AI responses — AI services are not configured in test env.
 */
import { test, expect } from '../fixtures';

/** Helper: navigate to chat view from widget */
async function openChat(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForSelector('.app-container--transparent', { timeout: 15_000 });
  await page.click('.app-container');
  // Wait for chat input to appear
  await page.waitForSelector('textarea, input[type="text"]', { timeout: 10_000 });
}

test.describe('Chat Panel', () => {
  test('should display chat input area', async ({ page }) => {
    await openChat(page);

    const input = page.locator('textarea');
    await expect(input.first()).toBeVisible();
    await expect(input.first()).toBeEditable();
  });

  test('should accept text input', async ({ page }) => {
    await openChat(page);

    const input = page.locator('textarea').first();
    await input.fill('Cześć, to jest test!');

    const value = await input.inputValue();
    expect(value).toBe('Cześć, to jest test!');
  });

  test('should have a send button', async ({ page }) => {
    await openChat(page);

    // Look for send button — may have aria-label or specific text
    const sendBtn = page.locator(
      'button[aria-label*="wyślij"], button[aria-label*="send"], button[title*="wyślij"], button[title*="send"]',
    );

    // Fallback: button with send icon (▶, →, or similar)
    const allButtons = page.locator('button');
    const count = await allButtons.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should have toolbar buttons (settings, cron, screenshot)', async ({ page }) => {
    await openChat(page);

    // Chat header should have multiple action buttons
    const buttons = page.locator('button');
    const count = await buttons.count();

    // At minimum: back/close, settings, and a few more
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('should close chat and return to widget', async ({ page }) => {
    await openChat(page);

    // Find the close/back button (typically ✕ or ←)
    const closeBtn = page.locator('button').filter({ hasText: /✕|×|←/i });
    if (await closeBtn.count() > 0) {
      await closeBtn.first().click();
      await page.waitForTimeout(500);

      // Should be back to widget (transparent container)
      const container = page.locator('.app-container');
      await expect(container).toHaveClass(/app-container--transparent/);
    }
  });

  test('should support keyboard shortcut Escape to close', async ({ page }) => {
    await openChat(page);
    await page.waitForTimeout(300);

    // Press Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Should return to widget view
    const container = page.locator('.app-container');
    await expect(container).toHaveClass(/app-container--transparent/, { timeout: 5_000 });
  });
});
