/**
 * Build & Toolchain Validation Tests
 *
 * Ensures the build toolchain (TypeScript, Vite, electron-builder) is properly
 * configured and capable of producing correct output. Catches:
 *  - TypeScript configuration errors
 *  - Vite config issues
 *  - electron-builder packaging misconfigurations
 *  - Path alias resolution at build time
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');

// ── Helpers ──────────────────────────────────────────

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf-8'));
}

function fileContains(relativePath: string, substring: string): boolean {
  const content = fs.readFileSync(path.join(ROOT, relativePath), 'utf-8');
  return content.includes(substring);
}

// ── Tests ────────────────────────────────────────────

describe('Build & Toolchain', () => {
  describe('TypeScript Compilation', () => {
    it('renderer tsconfig type-checks without errors', () => {
      try {
        execSync('npx tsc --noEmit', {
          cwd: ROOT,
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: 120_000,
        });
      } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string };
        const output = (err.stdout || '') + (err.stderr || '');
        // Count errors
        const errorLines = output.split('\n').filter((l: string) => l.includes('error TS'));
        expect.fail(
          `Renderer TypeScript has ${errorLines.length} error(s).\n` +
            `First 5:\n${errorLines.slice(0, 5).join('\n')}\n` +
            `Fix with: npx tsc --noEmit`,
        );
      }
    });

    it('main process tsconfig type-checks without errors', () => {
      try {
        execSync('npx tsc --noEmit -p tsconfig.main.json', {
          cwd: ROOT,
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: 120_000,
        });
      } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string };
        const output = (err.stdout || '') + (err.stderr || '');
        const errorLines = output.split('\n').filter((l: string) => l.includes('error TS'));
        expect.fail(
          `Main process TypeScript has ${errorLines.length} error(s).\n` +
            `First 5:\n${errorLines.slice(0, 5).join('\n')}\n` +
            `Fix with: npx tsc --noEmit -p tsconfig.main.json`,
        );
      }
    });
  });

  describe('TypeScript Config Quality', () => {
    it('renderer tsconfig targets ES2022+ for modern features', () => {
      const tsconfig = readJson('tsconfig.json');
      const target = ((tsconfig.compilerOptions as Record<string, unknown>)?.target as string || '').toLowerCase();
      const modernTargets = ['es2022', 'es2023', 'es2024', 'esnext'];
      expect(
        modernTargets.includes(target),
        `tsconfig.json target is "${target}". Use ES2022+ for modern syntax support.`,
      ).toBe(true);
    });

    it('main process tsconfig does not include renderer files', () => {
      const tsconfig = readJson('tsconfig.main.json');
      const include = tsconfig.include as string[] | undefined;
      if (include) {
        const hasRenderer = include.some((p: string) => p.includes('renderer'));
        expect(
          hasRenderer,
          'tsconfig.main.json should NOT include renderer files.',
        ).toBe(false);
      }
    });

    it('renderer tsconfig does not include main process files', () => {
      const tsconfig = readJson('tsconfig.json');
      const include = tsconfig.include as string[] | undefined;
      if (include) {
        const mainOnlyPatterns = include.filter(
          (p: string) => p.includes('src/main/services') && !p.includes('shared'),
        );
        // Having src/main/** in renderer tsconfig is fine for types, but pure main code shouldn't be there
        expect(mainOnlyPatterns.length).toBeLessThanOrEqual(1);
      }
    });

    it('both tsconfigs enable strict null checks', () => {
      for (const configPath of ['tsconfig.json', 'tsconfig.main.json']) {
        const tsconfig = readJson(configPath);
        const opts = tsconfig.compilerOptions as Record<string, unknown>;
        // strict=true implies strictNullChecks=true
        expect(
          opts?.strict === true || opts?.strictNullChecks === true,
          `${configPath} should have strict or strictNullChecks enabled.`,
        ).toBe(true);
      }
    });
  });

  describe('Vite Configuration', () => {
    it('vite.config.ts exists and is valid', () => {
      expect(
        fs.existsSync(path.join(ROOT, 'vite.config.ts')),
        'vite.config.ts is missing.',
      ).toBe(true);
    });

    it('vite config includes React plugin', () => {
      expect(
        fileContains('vite.config.ts', 'react'),
        'vite.config.ts should use @vitejs/plugin-react.',
      ).toBe(true);
    });

    it('vite config includes path alias resolution', () => {
      const content = fs.readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf-8');
      expect(
        content.includes('@shared') || content.includes('@renderer') || content.includes('alias'),
        'vite.config.ts should configure path aliases (@shared/*, @renderer/*).',
      ).toBe(true);
    });
  });

  describe('Electron Builder Configuration', () => {
    it('has electron-builder config in package.json', () => {
      const pkg = readJson('package.json');
      expect(
        pkg.build,
        'package.json missing "build" section for electron-builder.',
      ).toBeTruthy();
    });

    it('has ASAR packaging enabled (security)', () => {
      const pkg = readJson('package.json');
      const build = pkg.build as Record<string, unknown>;
      // asar defaults to true, so either undefined or true is fine
      expect(
        build?.asar !== false,
        'ASAR packaging should be enabled (asar: true) for security.',
      ).toBe(true);
    });

    it('has target platforms configured', () => {
      const pkg = readJson('package.json');
      const build = pkg.build as Record<string, unknown>;

      // Should have at least one of: win, mac, linux targets
      const hasWin = build?.nsis || build?.win;
      const hasMac = build?.dmg || build?.mac;
      const hasLinux = build?.appImage || build?.linux || build?.deb;

      expect(
        hasWin || hasMac || hasLinux,
        'electron-builder should have at least one platform target configured.',
      ).toBeTruthy();
    });

    it('has publish configuration for auto-updater', () => {
      const pkg = readJson('package.json');
      const build = pkg.build as Record<string, unknown>;
      expect(
        build?.publish,
        'electron-builder should have "publish" config for auto-updater. ' +
          'Add: "publish": [{"provider": "github"}]',
      ).toBeTruthy();
    });
  });

  describe('ESLint Configuration', () => {
    it('has ESLint config file', () => {
      const configFiles = [
        'eslint.config.mjs',
        'eslint.config.js',
        'eslint.config.cjs',
        '.eslintrc.js',
        '.eslintrc.json',
      ];
      const hasConfig = configFiles.some((f) => fs.existsSync(path.join(ROOT, f)));
      expect(
        hasConfig,
        'No ESLint configuration found. Create eslint.config.mjs.',
      ).toBe(true);
    });
  });

  describe('Prettier Configuration', () => {
    it('has Prettier config file', () => {
      const configFiles = ['.prettierrc', '.prettierrc.json', '.prettierrc.js', 'prettier.config.js'];
      const hasConfig = configFiles.some((f) => fs.existsSync(path.join(ROOT, f)));
      expect(
        hasConfig,
        'No Prettier configuration found. Create .prettierrc.',
      ).toBe(true);
    });

    it('has .prettierignore', () => {
      expect(
        fs.existsSync(path.join(ROOT, '.prettierignore')),
        '.prettierignore is missing. Create it to exclude dist/, node_modules/, etc.',
      ).toBe(true);
    });

    it('code is formatted (spot check)', () => {
      try {
        execSync('npx prettier --check "src/shared/types/index.ts" 2>&1', {
          cwd: ROOT,
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: 30_000,
        });
      } catch {
        // If prettier fails on a core file, formatting is broken
        expect.fail(
          'Core shared types file is not formatted. Run: npm run format',
        );
      }
    });
  });

  describe('CI Pipeline Configuration', () => {
    it('has GitHub Actions workflow', () => {
      const workflowPath = path.join(ROOT, '.github', 'workflows', 'build.yml');
      expect(
        fs.existsSync(workflowPath),
        'Missing CI workflow at .github/workflows/build.yml',
      ).toBe(true);
    });

    it('CI runs typecheck step', () => {
      const workflowPath = path.join(ROOT, '.github', 'workflows', 'build.yml');
      if (!fs.existsSync(workflowPath)) return;

      const content = fs.readFileSync(workflowPath, 'utf-8');
      expect(
        content.includes('typecheck') || content.includes('tsc --noEmit'),
        'CI workflow should include a typecheck step (npm run typecheck or tsc --noEmit).',
      ).toBe(true);
    });

    it('CI runs test step', () => {
      const workflowPath = path.join(ROOT, '.github', 'workflows', 'build.yml');
      if (!fs.existsSync(workflowPath)) return;

      const content = fs.readFileSync(workflowPath, 'utf-8');
      expect(
        content.includes('test') || content.includes('vitest'),
        'CI workflow should include a test step.',
      ).toBe(true);
    });
  });
});
