/**
 * E2E Test Environment Setup — pre-populate userData for Electron tests.
 *
 * Creates a minimal config file so the app skips onboarding by default.
 * Tests that WANT to test onboarding can use `setupFreshEnvironment()` instead.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const TEST_DIR_PREFIX = 'kxai-e2e-test-';

/** Create a unique temporary directory for test user data */
export function getTestUserDataDir(): string {
  return path.join(os.tmpdir(), `${TEST_DIR_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

/**
 * Pre-populate userDataDir with a config that marks onboarding as complete.
 * This lets tests start at the widget view without going through the wizard.
 */
export function setupTestEnvironment(userDataDir: string): void {
  fs.mkdirSync(userDataDir, { recursive: true });

  // Create workspace directories that services expect
  const workspace = path.join(userDataDir, 'workspace');
  fs.mkdirSync(path.join(workspace, 'memory'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'cron'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'workflow'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'workflow', 'macros'), { recursive: true });

  // Write minimal config — onboarded + basic settings
  const config = {
    configVersion: 1,
    onboarded: true,
    userName: 'Test User',
    userRole: 'Tester',
    userDescription: 'E2E test user',
    agentName: 'TestBot',
    agentEmoji: '🤖',
    aiProvider: 'openai',
    aiModel: 'gpt-5',
    userLanguage: 'pl',
    // Disable features that need external services
    proactiveMode: false,
    screenMonitorEnabled: false,
    enableClipboardMonitor: false,
  };

  fs.writeFileSync(path.join(userDataDir, 'kxai-config.json'), JSON.stringify(config, null, 2));
}

/**
 * Create a fresh environment WITHOUT onboarding completed.
 * Use this for onboarding flow tests.
 */
export function setupFreshEnvironment(userDataDir: string): void {
  fs.mkdirSync(userDataDir, { recursive: true });

  const workspace = path.join(userDataDir, 'workspace');
  fs.mkdirSync(path.join(workspace, 'memory'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'cron'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'workflow'), { recursive: true });

  // Write config WITHOUT onboarded flag
  const config = {
    configVersion: 1,
    onboarded: false,
    aiProvider: 'openai',
    aiModel: 'gpt-5',
    userLanguage: 'pl',
    proactiveMode: false,
    screenMonitorEnabled: false,
    enableClipboardMonitor: false,
  };

  fs.writeFileSync(path.join(userDataDir, 'kxai-config.json'), JSON.stringify(config, null, 2));
}

/** Remove the temporary test data directory */
export function cleanupTestEnvironment(userDataDir: string): void {
  try {
    if (userDataDir.includes(TEST_DIR_PREFIX) && fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  } catch {
    // Best effort cleanup — temp dirs will be cleaned by OS eventually
  }
}
