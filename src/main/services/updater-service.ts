/**
 * UpdaterService — Auto-update management for KxAI.
 *
 * Uses electron-updater with GitHub Releases as update source.
 * Checks for updates on startup and periodically (every 4 hours).
 * Emits events to renderer for UI notifications.
 *
 * @module main/services/updater-service
 */

import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
import { BrowserWindow } from 'electron';
import { createLogger } from './logger';
import { Ev } from '../../shared/ipc-schema';

const log = createLogger('Updater');

/** Update state pushed to renderer */
export interface UpdateState {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  releaseNotes?: string;
  progress?: {
    percent: number;
    bytesPerSecond: number;
    transferred: number;
    total: number;
  };
  error?: string;
}

export class UpdaterService {
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private mainWindow: BrowserWindow | null = null;
  private currentState: UpdateState = { status: 'not-available' };

  /** Whether an update has been downloaded and is ready to install */
  private updateDownloaded = false;

  constructor() {
    // Configure electron-updater
    autoUpdater.autoDownload = false; // Don't download automatically — let user decide
    autoUpdater.autoInstallOnAppQuit = true; // Install on next quit if downloaded
    autoUpdater.allowDowngrade = false;

    // Suppress default dialog — we handle UI ourselves
    autoUpdater.autoRunAppAfterInstall = true;

    this.setupEventHandlers();
  }

  /**
   * Initialize the updater — call after BrowserWindow is created.
   * Starts periodic update checks (every 4 hours).
   */
  initialize(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;

    // Check for updates after a short delay (let app finish loading)
    setTimeout(() => {
      this.checkForUpdates();
    }, 10_000);

    // Periodic check every 4 hours
    this.checkInterval = setInterval(
      () => this.checkForUpdates(),
      4 * 60 * 60 * 1000,
    );

    log.info('Updater initialized — auto-check every 4h');
  }

  /**
   * Manually trigger an update check.
   */
  async checkForUpdates(): Promise<UpdateState> {
    try {
      this.setState({ status: 'checking' });
      await autoUpdater.checkForUpdates();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Don't log network errors as errors — they're expected when offline
      if (msg.includes('net::') || msg.includes('ENOTFOUND') || msg.includes('ETIMEDOUT')) {
        log.info('Update check skipped — network unavailable');
      } else {
        log.warn('Update check failed:', msg);
      }
      this.setState({ status: 'error', error: msg });
    }
    return this.currentState;
  }

  /**
   * Start downloading the available update.
   */
  async downloadUpdate(): Promise<void> {
    try {
      this.setState({ status: 'downloading' });
      await autoUpdater.downloadUpdate();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('Update download failed:', msg);
      this.setState({ status: 'error', error: msg });
    }
  }

  /**
   * Install the downloaded update and restart the app.
   */
  installUpdate(): void {
    if (!this.updateDownloaded) {
      log.warn('No update downloaded — cannot install');
      return;
    }
    log.info('Installing update and restarting...');
    autoUpdater.quitAndInstall(false, true);
  }

  /**
   * Get current update state.
   */
  getState(): UpdateState {
    return { ...this.currentState };
  }

  /**
   * Check if an update has been downloaded and is ready to install.
   */
  isUpdateReady(): boolean {
    return this.updateDownloaded;
  }

  /**
   * Cleanup — stop periodic checks.
   */
  destroy(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.mainWindow = null;
    log.info('Updater destroyed');
  }

  // ─── Private ───

  private setupEventHandlers(): void {
    autoUpdater.on('checking-for-update', () => {
      log.info('Checking for updates...');
      this.setState({ status: 'checking' });
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      log.info(`Update available: v${info.version}`);
      const releaseNotes = typeof info.releaseNotes === 'string'
        ? info.releaseNotes
        : Array.isArray(info.releaseNotes)
          ? info.releaseNotes.map((n) => n.note).join('\n')
          : undefined;

      this.setState({
        status: 'available',
        version: info.version,
        releaseNotes,
      });
    });

    autoUpdater.on('update-not-available', (_info: UpdateInfo) => {
      log.info('No updates available');
      this.setState({ status: 'not-available' });
    });

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.setState({
        status: 'downloading',
        progress: {
          percent: Math.round(progress.percent),
          bytesPerSecond: progress.bytesPerSecond,
          transferred: progress.transferred,
          total: progress.total,
        },
      });
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      log.info(`Update downloaded: v${info.version}`);
      this.updateDownloaded = true;

      const releaseNotes = typeof info.releaseNotes === 'string'
        ? info.releaseNotes
        : Array.isArray(info.releaseNotes)
          ? info.releaseNotes.map((n) => n.note).join('\n')
          : undefined;

      this.setState({
        status: 'downloaded',
        version: info.version,
        releaseNotes,
      });
    });

    autoUpdater.on('error', (err: Error) => {
      // Don't spam logs with network errors
      if (err.message.includes('net::') || err.message.includes('ENOTFOUND')) {
        return;
      }
      log.error('Updater error:', err.message);
      this.setState({ status: 'error', error: err.message });
    });
  }

  private setState(state: Partial<UpdateState>): void {
    this.currentState = { ...this.currentState, ...state };
    this.pushToRenderer();
  }

  private pushToRenderer(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    this.mainWindow.webContents.send(Ev.UPDATE_STATE, this.currentState);
  }
}
