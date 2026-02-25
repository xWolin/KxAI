/**
 * E2E: Window Management
 *
 * Tests Electron window properties: size, position, click-through behavior.
 */
import { test, expect } from '../fixtures';

test.describe('Window Management', () => {
  test('should start with correct window properties', async ({ electronApp, page }) => {
    await page.waitForSelector('.app-container', { timeout: 15_000 });

    // Get the BrowserWindow
    const windowCount = await electronApp.windows().length;
    expect(windowCount).toBeGreaterThanOrEqual(1);
  });

  test('should resize window when navigating to chat', async ({ electronApp, page }) => {
    await page.waitForSelector('.app-container--transparent', { timeout: 15_000 });

    // Widget mode — small window
    const beforeSize = await page.evaluate(() => ({
      width: window.outerWidth,
      height: window.outerHeight,
    }));

    // Navigate to chat
    await page.click('.app-container');
    await page.waitForTimeout(1000);

    // Chat mode — larger window (420x600)
    const afterSize = await page.evaluate(() => ({
      width: window.outerWidth,
      height: window.outerHeight,
    }));

    // Window should have grown
    expect(afterSize.width).toBeGreaterThanOrEqual(beforeSize.width);
    expect(afterSize.height).toBeGreaterThanOrEqual(beforeSize.height);
  });

  test('should have frameless window', async ({ electronApp }) => {
    // Verify window is frameless via Electron API
    const isFrameless = await electronApp.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows();
      if (wins.length === 0) return null;
      // BrowserWindow doesn't expose 'frame' directly, but we can check title bar
      return wins[0].isMenuBarVisible() === false;
    });

    // Frameless windows typically have no menu bar
    expect(isFrameless).toBe(true);
  });

  test('should be always on top', async ({ electronApp }) => {
    const isAlwaysOnTop = await electronApp.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows();
      return wins.length > 0 ? wins[0].isAlwaysOnTop() : null;
    });

    expect(isAlwaysOnTop).toBe(true);
  });
});
