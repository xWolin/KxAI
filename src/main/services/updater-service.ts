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
import { BrowserWindow, shell } from 'electron';
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
  /** When true, auto-update is not possible — user must download manually */
  manualOnly?: boolean;
  /** Direct download URL for manual updates (GitHub Releases) */
  downloadUrl?: string;
}

export class UpdaterService {
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private mainWindow: BrowserWindow | null = null;
  private currentState: UpdateState = { status: 'not-available' };

  /** Whether an update has been downloaded and is ready to install */
  private updateDownloaded = false;

  /**
   * On macOS without a real Developer ID certificate, Squirrel.Mac cannot verify
   * code signatures on downloaded updates (ad-hoc signed apps fail validation).
   * When true, we still CHECK for updates but skip download/install — instead we
   * show the user a link to GitHub Releases for manual download.
   */
  private readonly manualUpdateOnly: boolean;

  /** GitHub Releases base URL for manual download links */
  private readonly releasesUrl = 'https://github.com/xWolin/KxAI/releases';

  constructor() {
    // Detect ad-hoc signed macOS build — Squirrel.Mac requires real code signing
    // The CSC_IDENTITY_AUTO_DISCOVERY env var is set to 'false' in CI when no cert exists,
    // and ad-hoc signed apps have identity "-" which fails Squirrel validation.
    // Simplest detection: on macOS, if the app is not properly signed, the identity
    // embedded by electron-builder will be "-" (ad-hoc). We detect this at runtime
    // by checking if the app is packaged but the codesign lacks a team identifier.
    this.manualUpdateOnly = process.platform === 'darwin' && this.isAdHocSigned();

    if (this.manualUpdateOnly) {
      log.info('macOS ad-hoc signed build detected — auto-update disabled, manual download only');
    }

    // Configure electron-updater
    autoUpdater.autoDownload = false; // Don't download automatically — let user decide
    autoUpdater.autoInstallOnAppQuit = true; // Install on next quit if downloaded
    autoUpdater.allowDowngrade = false;

    // Suppress default dialog — we handle UI ourselves
    autoUpdater.autoRunAppAfterInstall = true;

    this.setupEventHandlers();
  }

  /**
   * Detect if the current macOS app bundle is ad-hoc signed (identity "-").
   * Ad-hoc signed apps cannot use Squirrel.Mac for delta updates.
   */
  private isAdHocSigned(): boolean {
    if (process.platform !== 'darwin') return false;

    try {
      const { execSync } = require('child_process');
      const appPath = require('electron').app.getPath('exe');
      // Get the .app bundle path from the executable path
      // e.g. /Applications/KxAI.app/Contents/MacOS/KxAI → /Applications/KxAI.app
      const appBundle = appPath.replace(/\/Contents\/MacOS\/.*$/, '');
      const result = execSync(`codesign -dvvv "${appBundle}" 2>&1`, { encoding: 'utf8', timeout: 5000 });
      // Real certificates have a TeamIdentifier, ad-hoc has "not set"
      const hasTeamId = /TeamIdentifier=(?!not set)/.test(result);
      return !hasTeamId;
    } catch {
      // If codesign check fails, assume ad-hoc (safer — prevents crash on update)
      return true;
    }
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
    this.checkInterval = setInterval(() => this.checkForUpdates(), 4 * 60 * 60 * 1000);

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
   * On macOS without code signing, opens GitHub Releases in browser instead.
   */
  async downloadUpdate(): Promise<void> {
    if (this.manualUpdateOnly) {
      // Cannot use Squirrel — open GitHub Releases for manual download
      const version = this.currentState.version;
      const url = version ? `${this.releasesUrl}/tag/v${version}` : `${this.releasesUrl}/latest`;
      log.info(`Manual update: opening ${url}`);
      shell.openExternal(url);
      return;
    }

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
      const releaseNotes =
        typeof info.releaseNotes === 'string'
          ? info.releaseNotes
          : Array.isArray(info.releaseNotes)
            ? info.releaseNotes.map((n) => n.note).join('\n')
            : undefined;

      this.setState({
        status: 'available',
        version: info.version,
        releaseNotes,
        manualOnly: this.manualUpdateOnly,
        downloadUrl: this.manualUpdateOnly ? `${this.releasesUrl}/tag/v${info.version}` : undefined,
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

      const releaseNotes =
        typeof info.releaseNotes === 'string'
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
