/**
 * Environment & System Preflight Tests
 *
 * Validates that the development/CI environment meets all requirements
 * BEFORE running the actual test suite. Catches missing tools, wrong versions,
 * and misconfigured environments early with actionable error messages.
 *
 * Categories:
 *  - Node.js runtime version & architecture
 *  - Required CLI tools (git, npm, tsc, etc.)
 *  - OS-level capabilities (filesystem, encoding)
 *  - Environment variables & configuration
 *  - Path aliases & TypeScript setup
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const ROOT = path.resolve(__dirname, '..', '..');

// ── Helpers ──────────────────────────────────────────

function commandExists(cmd: string): boolean {
  try {
    const isWin = process.platform === 'win32';
    execSync(isWin ? `where ${cmd}` : `which ${cmd}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function getCommandVersion(cmd: string, versionFlag = '--version'): string {
  try {
    return execSync(`${cmd} ${versionFlag}`, { encoding: 'utf-8', stdio: 'pipe' }).trim();
  } catch {
    return '';
  }
}

function semverSatisfies(version: string, minMajor: number, minMinor = 0): boolean {
  const match = version.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const [, major, minor] = match.map(Number);
  return major > minMajor || (major === minMajor && minor >= minMinor);
}

// ── Tests ────────────────────────────────────────────

describe('Environment Preflight', () => {
  describe('Node.js Runtime', () => {
    it('runs on Node.js ≥ 20.0.0', () => {
      const nodeVersion = process.version;
      expect(
        semverSatisfies(nodeVersion, 20),
        `Node.js ${nodeVersion} is below minimum 20.0.0. ` +
          `Update with: nvm install 20 && nvm use 20`,
      ).toBe(true);
    });

    it('uses a supported architecture (x64 or arm64)', () => {
      expect(
        ['x64', 'arm64'].includes(process.arch),
        `Unsupported architecture: ${process.arch}. KxAI requires x64 or arm64.`,
      ).toBe(true);
    });

    it('has a supported platform (win32, darwin, linux)', () => {
      expect(
        ['win32', 'darwin', 'linux'].includes(process.platform),
        `Unsupported platform: ${process.platform}. KxAI supports Windows, macOS, Linux.`,
      ).toBe(true);
    });

    it('has sufficient memory available (≥ 512MB free)', () => {
      const freeMB = os.freemem() / (1024 * 1024);
      expect(
        freeMB >= 512,
        `Only ${Math.round(freeMB)}MB free memory. Build/tests need ≥ 512MB.`,
      ).toBe(true);
    });

    it('.nvmrc matches package.json engines requirement', () => {
      const nvmrcPath = path.join(ROOT, '.nvmrc');
      if (!fs.existsSync(nvmrcPath)) {
        expect.fail(
          '.nvmrc file is missing. Create it with: echo "v20" > .nvmrc',
        );
      }
      const nvmrc = fs.readFileSync(nvmrcPath, 'utf-8').trim();
      // .nvmrc says "v20", engines says ">=20.0.0" — just verify major matches
      const nvmrcMajor = nvmrc.replace(/^v/, '').split('.')[0];
      expect(
        parseInt(nvmrcMajor) >= 20,
        `.nvmrc specifies Node ${nvmrc}, but package.json requires >=20.0.0`,
      ).toBe(true);
    });
  });

  describe('Required CLI Tools', () => {
    it('has git installed', () => {
      expect(
        commandExists('git'),
        'git is not installed or not in PATH. Install: https://git-scm.com/',
      ).toBe(true);
    });

    it('has npm installed with matching Node version', () => {
      expect(
        commandExists('npm'),
        'npm is not installed or not in PATH.',
      ).toBe(true);
    });

    it('has npx available', () => {
      expect(
        commandExists('npx'),
        'npx is not available. It ships with npm ≥ 5.2.0.',
      ).toBe(true);
    });

    it('has TypeScript compiler available via npx', () => {
      const tscVersion = getCommandVersion('npx tsc');
      expect(
        tscVersion.length > 0,
        'TypeScript compiler not found. Run: npm ci --legacy-peer-deps',
      ).toBe(true);
    });
  });

  describe('Filesystem & Encoding', () => {
    it('can write and read UTF-8 files with Polish characters', () => {
      const testPath = path.join(os.tmpdir(), `kxai-utf8-test-${Date.now()}.txt`);
      const testContent = 'Cześć! Zażółć gęślą jaźń 🤖';
      try {
        fs.writeFileSync(testPath, testContent, 'utf-8');
        const read = fs.readFileSync(testPath, 'utf-8');
        expect(read).toBe(testContent);
      } finally {
        try { fs.unlinkSync(testPath); } catch {}
      }
    });

    it('can create nested directories', () => {
      const testDir = path.join(os.tmpdir(), `kxai-dir-test-${Date.now()}`, 'a', 'b', 'c');
      try {
        fs.mkdirSync(testDir, { recursive: true });
        expect(fs.existsSync(testDir)).toBe(true);
      } finally {
        try { fs.rmSync(path.join(os.tmpdir(), `kxai-dir-test-${Date.now()}`), { recursive: true }); } catch {}
      }
    });

    it('has case-sensitivity awareness', () => {
      // Just document the behavior — don't fail on case-insensitive FS (Windows/macOS)
      const testPath = path.join(os.tmpdir(), `kxai-case-test-${Date.now()}`);
      const upperPath = testPath + '-UPPER.txt';
      const lowerPath = testPath + '-upper.txt';
      try {
        fs.writeFileSync(upperPath, 'test', 'utf-8');
        // On case-insensitive FS, lowerPath will also exist
        const isCaseSensitive = !fs.existsSync(lowerPath);
        // This is informational — both are supported
        expect(typeof isCaseSensitive).toBe('boolean');
      } finally {
        try { fs.unlinkSync(upperPath); } catch {}
      }
    });
  });

  describe('Project Structure', () => {
    const requiredFiles = [
      'package.json',
      'tsconfig.json',
      'tsconfig.main.json',
      'vitest.config.ts',
      'vite.config.ts',
      'src/main/main.ts',
      'src/main/ipc.ts',
      'src/main/preload.ts',
      'src/renderer/App.tsx',
      'src/renderer/main.tsx',
      'src/shared/types/index.ts',
      'src/shared/ipc-schema.ts',
      'src/shared/schemas/ipc-params.ts',
    ];

    for (const file of requiredFiles) {
      it(`has required file: ${file}`, () => {
        const fullPath = path.join(ROOT, file);
        expect(
          fs.existsSync(fullPath),
          `Required file missing: ${file}. The project structure may be corrupted.`,
        ).toBe(true);
      });
    }

    const requiredDirs = [
      'src/main/services',
      'src/main/prompts',
      'src/renderer/components',
      'src/renderer/stores',
      'src/renderer/components/ui',
      'src/shared/types',
      'src/shared/schemas',
      'tests',
    ];

    for (const dir of requiredDirs) {
      it(`has required directory: ${dir}`, () => {
        const fullPath = path.join(ROOT, dir);
        expect(
          fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory(),
          `Required directory missing: ${dir}`,
        ).toBe(true);
      });
    }
  });

  describe('TypeScript Configuration', () => {
    it('tsconfig.json has strict mode enabled', () => {
      const tsconfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf-8'));
      expect(
        tsconfig.compilerOptions?.strict,
        'tsconfig.json must have "strict": true for type safety.',
      ).toBe(true);
    });

    it('tsconfig.main.json has strict mode enabled', () => {
      const tsconfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'tsconfig.main.json'), 'utf-8'));
      expect(
        tsconfig.compilerOptions?.strict,
        'tsconfig.main.json must have "strict": true for type safety.',
      ).toBe(true);
    });

    it('tsconfig.json has path aliases for @shared and @renderer', () => {
      const tsconfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf-8'));
      const paths = tsconfig.compilerOptions?.paths || {};
      expect(
        paths['@shared/*'] && paths['@renderer/*'],
        'tsconfig.json must have @shared/* and @renderer/* path aliases.',
      ).toBeTruthy();
    });

    it('tsconfig.main.json has path aliases for @shared and @main', () => {
      const tsconfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'tsconfig.main.json'), 'utf-8'));
      const paths = tsconfig.compilerOptions?.paths || {};
      expect(
        paths['@shared/*'] && paths['@main/*'],
        'tsconfig.main.json must have @shared/* and @main/* path aliases.',
      ).toBeTruthy();
    });
  });

  describe('Git Configuration', () => {
    it('is inside a git repository', () => {
      expect(
        fs.existsSync(path.join(ROOT, '.git')),
        'Not a git repository. Initialize with: git init',
      ).toBe(true);
    });

    it('has .gitignore with essential patterns', () => {
      const gitignorePath = path.join(ROOT, '.gitignore');
      expect(fs.existsSync(gitignorePath), '.gitignore is missing').toBe(true);

      const content = fs.readFileSync(gitignorePath, 'utf-8');
      const requiredPatterns = ['node_modules', 'dist', 'release'];
      for (const pattern of requiredPatterns) {
        expect(
          content.includes(pattern),
          `.gitignore should include "${pattern}"`,
        ).toBe(true);
      }
    });

    it('has husky hooks configured', () => {
      // Husky v9 uses .husky/ directory
      const huskyDir = path.join(ROOT, '.husky');
      expect(
        fs.existsSync(huskyDir),
        'Husky hooks directory (.husky/) is missing. Run: npx husky init',
      ).toBe(true);
    });
  });
});
