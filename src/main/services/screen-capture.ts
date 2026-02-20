import { desktopCapturer, screen } from 'electron';

export interface ScreenshotData {
  displayId: number;
  displayLabel: string;
  base64: string;
  width: number;
  height: number;
  timestamp: number;
}

export class ScreenCaptureService {
  private watchInterval: NodeJS.Timeout | null = null;
  private isWatching = false;

  async captureAllScreens(): Promise<ScreenshotData[]> {
    const displays = screen.getAllDisplays();
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
    });

    const screenshots: ScreenshotData[] = [];

    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      const display = displays[i] || displays[0];
      
      const thumbnail = source.thumbnail;
      if (thumbnail && !thumbnail.isEmpty()) {
        screenshots.push({
          displayId: display.id,
          displayLabel: source.name || `Monitor ${i + 1}`,
          base64: thumbnail.toDataURL(),
          width: thumbnail.getSize().width,
          height: thumbnail.getSize().height,
          timestamp: Date.now(),
        });
      }
    }

    return screenshots;
  }

  async captureScreen(displayIndex: number = 0): Promise<ScreenshotData | null> {
    const screenshots = await this.captureAllScreens();
    return screenshots[displayIndex] || null;
  }

  startWatching(
    intervalMs: number,
    callback: (screenshots: ScreenshotData[]) => void
  ): void {
    if (this.isWatching) {
      this.stopWatching();
    }

    this.isWatching = true;
    
    // Initial capture
    this.captureAllScreens().then(callback).catch(console.error);

    // Periodic capture
    this.watchInterval = setInterval(async () => {
      try {
        const screenshots = await this.captureAllScreens();
        callback(screenshots);
      } catch (error) {
        console.error('Screen capture error:', error);
      }
    }, Math.max(intervalMs, 5000)); // Minimum 5 second interval for safety
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
   * 640x360 is enough for AI vision and much cheaper/faster.
   */
  async captureFast(): Promise<ScreenshotData | null> {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 640, height: 360 },
      });

      if (sources.length > 0 && sources[0].thumbnail && !sources[0].thumbnail.isEmpty()) {
        const thumbnail = sources[0].thumbnail;
        return {
          displayId: 0,
          displayLabel: 'primary',
          base64: thumbnail.toDataURL(),
          width: thumbnail.getSize().width,
          height: thumbnail.getSize().height,
          timestamp: Date.now(),
        };
      }
    } catch (error) {
      console.error('Fast capture error:', error);
    }
    return null;
  }
}
