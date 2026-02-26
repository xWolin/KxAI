import { desktopCapturer, screen, systemPreferences } from 'electron';
import { createLogger } from './logger';

const log = createLogger('ScreenCapture');

export interface ScreenshotData {
  displayId: number;
  displayIndex?: number;
  displayLabel: string;
  base64: string;
  width: number;
  height: number;
  timestamp: number;
}

export class ScreenCaptureService {
  private watchInterval: NodeJS.Timeout | null = null;
  private isWatching = false;

  /**
   * Check if screen recording permission is granted on macOS.
   * On other platforms, always returns true.
   */
  hasScreenPermission(): boolean {
    if (process.platform !== 'darwin') return true;
    return systemPreferences.getMediaAccessStatus('screen') === 'granted';
  }

  /**
   * Get the actual display size (with DPI scaling) for a display.
   */
  private getDisplaySize(display: Electron.Display): { width: number; height: number } {
    // Use physical pixel size (accounts for DPI scaling)
    const scaleFactor = display.scaleFactor || 1;
    return {
      width: Math.round(display.size.width * scaleFactor),
      height: Math.round(display.size.height * scaleFactor),
    };
  }

  /**
   * Scale a display size down to fit within maxDimension while preserving aspect ratio.
   */
  private scaleToFit(width: number, height: number, maxDimension: number): { width: number; height: number } {
    if (width <= maxDimension && height <= maxDimension) {
      return { width, height };
    }
    const ratio = Math.min(maxDimension / width, maxDimension / height);
    return {
      width: Math.round(width * ratio),
      height: Math.round(height * ratio),
    };
  }

  async captureAllScreens(): Promise<ScreenshotData[]> {
    // macOS: check screen recording permission
    if (process.platform === 'darwin' && !this.hasScreenPermission()) {
      log.warn('macOS Screen Recording permission not granted. Screenshots will be empty.');
    }

    const displays = screen.getAllDisplays();
    log.info(`Capturing ${displays.length} display(s)`);

    // Capture each display individually for correct resolution per monitor.
    // desktopCapturer with a single thumbnailSize applies it to ALL sources,
    // which distorts monitors with different resolutions. We capture per-display instead.
    const screenshots: ScreenshotData[] = [];

    for (let displayIdx = 0; displayIdx < displays.length; displayIdx++) {
      const display = displays[displayIdx];
      const displaySize = this.getDisplaySize(display);

      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: displaySize,
        });

        // Match source to display: try by display_id in source.id (format: "screen:DISPLAY_ID:INDEX"),
        // then fall back to positional index
        const matchedSource = sources.find((s) => s.display_id === String(display.id)) || sources[displayIdx];

        if (matchedSource?.thumbnail && !matchedSource.thumbnail.isEmpty()) {
          screenshots.push({
            displayId: display.id,
            displayIndex: displayIdx,
            displayLabel: matchedSource.name || `Monitor ${displayIdx + 1}`,
            base64: matchedSource.thumbnail.toDataURL(),
            width: matchedSource.thumbnail.getSize().width,
            height: matchedSource.thumbnail.getSize().height,
            timestamp: Date.now(),
          });
        } else {
          log.warn(`Display ${displayIdx} (${display.id}): no thumbnail captured`);
        }
      } catch (err) {
        log.error(`Failed to capture display ${displayIdx}:`, err);
      }
    }

    log.info(`Captured ${screenshots.length}/${displays.length} screen(s)`);
    return screenshots;
  }

  async captureScreen(displayIndex: number = 0): Promise<ScreenshotData | null> {
    const screenshots = await this.captureAllScreens();
    return screenshots[displayIndex] || null;
  }

  startWatching(intervalMs: number, callback: (screenshots: ScreenshotData[]) => void): void {
    if (this.isWatching) {
      this.stopWatching();
    }

    this.isWatching = true;

    // Initial capture
    this.captureAllScreens().then(callback).catch(console.error);

    // Periodic capture
    this.watchInterval = setInterval(
      async () => {
        try {
          const screenshots = await this.captureAllScreens();
          callback(screenshots);
        } catch (error) {
          console.error('Screen capture error:', error);
        }
      },
      Math.max(intervalMs, 5000),
    ); // Minimum 5 second interval for safety
  }

  stopWatching(): void {
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
    }
    this.isWatching = false;
  }

  getWatchingStatus(): boolean {
    return this.isWatching;
  }

  /**
   * Fast capture at reduced resolution for take-control mode.
   * Scales down to max 800px on longest side — enough for AI vision, much cheaper.
   * Automatically adapts to actual display resolution and aspect ratio.
   */
  async captureFast(): Promise<ScreenshotData | null> {
    try {
      const primaryDisplay = screen.getPrimaryDisplay();
      const nativeSize = this.getDisplaySize(primaryDisplay);
      const scaled = this.scaleToFit(nativeSize.width, nativeSize.height, 800);

      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: scaled,
      });

      // Find primary display source
      const primary = sources.find((s) => s.display_id === String(primaryDisplay.id)) || sources[0];

      if (primary?.thumbnail && !primary.thumbnail.isEmpty()) {
        const thumbnail = primary.thumbnail;
        return {
          displayId: primaryDisplay.id,
          displayIndex: 0,
          displayLabel: 'primary',
          base64: thumbnail.toDataURL(),
          width: thumbnail.getSize().width,
          height: thumbnail.getSize().height,
          timestamp: Date.now(),
        };
      }
    } catch (error) {
      log.error('Fast capture error:', error);
    }
    return null;
  }

  /**
   * Capture screenshot scaled to XGA (1024x768) for Computer Use API.
   * Returns the screenshot + scale factors to map AI coordinates back to native resolution.
   *
   * Anthropic & OpenAI recommend XGA resolution for best accuracy.
   * Coordinates from AI are in the scaled space and must be converted back.
   */
  async captureForComputerUse(): Promise<ComputerUseScreenshot | null> {
    try {
      // macOS: check screen recording permission
      if (process.platform === 'darwin' && !this.hasScreenPermission()) {
        log.warn('macOS Screen Recording permission not granted');
        return null;
      }

      const primaryDisplay = screen.getPrimaryDisplay();
      const nativeSize = this.getDisplaySize(primaryDisplay);

      // Target XGA resolution (1024x768) — recommended by Anthropic
      const TARGET_WIDTH = 1024;
      const TARGET_HEIGHT = 768;

      // Scale to fit within XGA while preserving aspect ratio
      const scaled = this.scaleToFit(nativeSize.width, nativeSize.height, Math.max(TARGET_WIDTH, TARGET_HEIGHT));
      // Clamp to XGA bounds
      const captureWidth = Math.min(scaled.width, TARGET_WIDTH);
      const captureHeight = Math.min(scaled.height, TARGET_HEIGHT);

      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: captureWidth, height: captureHeight },
      });

      if (sources.length > 0 && sources[0].thumbnail && !sources[0].thumbnail.isEmpty()) {
        const thumbnail = sources[0].thumbnail;
        const actualWidth = thumbnail.getSize().width;
        const actualHeight = thumbnail.getSize().height;

        // Compute scale factors: AI coords × scaleX/Y = native coords
        const scaleX = nativeSize.width / actualWidth;
        const scaleY = nativeSize.height / actualHeight;

        // Extract raw base64 without data URL prefix for API efficiency
        const dataUrl = thumbnail.toDataURL();
        const rawBase64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');

        return {
          base64: rawBase64,
          dataUrl,
          width: actualWidth,
          height: actualHeight,
          nativeWidth: nativeSize.width,
          nativeHeight: nativeSize.height,
          scaleX,
          scaleY,
          timestamp: Date.now(),
        };
      }
    } catch (error) {
      log.error('Computer Use capture error:', error);
    }
    return null;
  }
}

/**
 * Screenshot data with coordinate scaling info for Computer Use API.
 */
export interface ComputerUseScreenshot {
  base64: string; // Raw base64 (no data: prefix) for API
  dataUrl: string; // Full data URL for OpenAI
  width: number; // Scaled width (≤1024)
  height: number; // Scaled height (≤768)
  nativeWidth: number; // Native screen width
  nativeHeight: number; // Native screen height
  scaleX: number; // Multiply AI x-coord by this to get native x
  scaleY: number; // Multiply AI y-coord by this to get native y
  timestamp: number;
}
