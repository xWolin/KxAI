#!/usr/bin/env node

/**
 * KxAI Preflight Check Script
 *
 * Cross-platform Node.js script that validates the development environment
 * before running the app or CI pipeline. Run directly with: node scripts/preflight.js
 *
 * Exit codes:
 *   0 = All checks passed
 *   1 = Critical check failed
 *   2 = Warnings only (non-blocking)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const IS_CI = !!process.env.CI;

// ── Styling ──────────────────────────────────────────

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

const PASS = green('✓');
const FAIL = red('✗');
const WARN = yellow('⚠');

// ── Tracking ─────────────────────────────────────────

let errors = 0;
let warnings = 0;
let passed = 0;

function pass(msg) {
  passed++;
  console.log(`  ${PASS} ${msg}`);
}

function fail(msg, hint) {
  errors++;
  console.log(`  ${FAIL} ${red(msg)}`);
  if (hint) console.log(`    ${dim(`→ ${hint}`)}`);
}

function warn(msg, hint) {
  warnings++;
  console.log(`  ${WARN} ${yellow(msg)}`);
  if (hint) console.log(`    ${dim(`→ ${hint}`)}`);
}

function section(title) {
  console.log(`\n${bold(`── ${title} ──`)}`);
}

function cmdExists(cmd) {
  try {
    const check = process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`;
    execSync(check, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function getVersion(cmd, flag = '--version') {
  try {
    return execSync(`${cmd} ${flag}`, { encoding: 'utf-8', stdio: 'pipe' }).trim();
  } catch {
    return null;
  }
}

function semverMajor(version) {
  const m = version?.match(/(\d+)\.\d+\.\d+/);
  return m ? parseInt(m[1]) : 0;
}

// ── Checks ───────────────────────────────────────────

console.log(bold('\n🔍 KxAI Preflight Check\n'));
console.log(dim(`Platform: ${process.platform} ${process.arch} | Node: ${process.version} | CI: ${IS_CI}`));

// 1. Node.js
section('Node.js Runtime');

const nodeMajor = semverMajor(process.version);
if (nodeMajor >= 20) {
  pass(`Node.js ${process.version}`);
} else {
  fail(`Node.js ${process.version} — requires ≥ 20.0.0`, 'nvm install 20 && nvm use 20');
}

if (['x64', 'arm64'].includes(process.arch)) {
  pass(`Architecture: ${process.arch}`);
} else {
  fail(`Unsupported architecture: ${process.arch}`, 'KxAI requires x64 or arm64');
}

// 2. CLI tools
section('CLI Tools');

for (const [cmd, hint] of [
  ['git', 'Install: https://git-scm.com/'],
  ['npm', 'Ships with Node.js'],
  ['npx', 'Ships with npm ≥ 5.2.0'],
]) {
  if (cmdExists(cmd)) {
    const ver = getVersion(cmd);
    pass(`${cmd} ${dim(ver?.split('\n')[0] || '')}`);
  } else {
    fail(`${cmd} not found`, hint);
  }
}

// 3. Project structure
section('Project Structure');

const requiredFiles = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.main.json',
  'vite.config.ts',
  'vitest.config.ts',
  'src/main/main.ts',
  'src/main/preload.ts',
  'src/renderer/App.tsx',
  'src/shared/types/index.ts',
];

for (const file of requiredFiles) {
  if (fs.existsSync(path.join(ROOT, file))) {
    pass(file);
  } else {
    const severity = file === 'package-lock.json' ? warn : fail;
    severity(`Missing: ${file}`, file === 'package-lock.json' ? 'npm install --legacy-peer-deps' : undefined);
  }
}

// 4. Dependencies
section('Dependencies');

const nmPath = path.join(ROOT, 'node_modules');
if (fs.existsSync(nmPath)) {
  const count = fs.readdirSync(nmPath).length;
  if (count > 50) {
    pass(`node_modules exists (${count} entries)`);
  } else {
    warn(`node_modules seems sparse (${count} entries)`, 'npm ci --legacy-peer-deps');
  }
} else {
  fail('node_modules is missing', 'npm ci --legacy-peer-deps');
}

// Check critical modules
const criticalModules = ['electron', 'react', 'better-sqlite3', 'zod', 'vitest', 'typescript'];
for (const mod of criticalModules) {
  try {
    const pkgPath = require.resolve(`${mod}/package.json`, { paths: [ROOT] });
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    pass(`${mod} v${pkg.version}`);
  } catch {
    fail(`${mod} not installed`, 'npm ci --legacy-peer-deps');
  }
}

// 5. TypeScript configs
section('TypeScript');

for (const configFile of ['tsconfig.json', 'tsconfig.main.json']) {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(ROOT, configFile), 'utf-8'));
    if (config.compilerOptions?.strict) {
      pass(`${configFile} strict mode ✓`);
    } else {
      warn(`${configFile} strict mode is OFF`, 'Set "strict": true in compilerOptions');
    }
  } catch {
    fail(`Cannot read ${configFile}`);
  }
}

// 6. Git
section('Git');

if (fs.existsSync(path.join(ROOT, '.git'))) {
  pass('Git repository initialized');
  
  try {
    const branch = execSync('git branch --show-current', { cwd: ROOT, encoding: 'utf-8', stdio: 'pipe' }).trim();
    pass(`Current branch: ${branch}`);
  } catch { /* skip */ }
  
  try {
    const status = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf-8', stdio: 'pipe' }).trim();
    const changed = status ? status.split('\n').length : 0;
    if (changed === 0) {
      pass('Working tree is clean');
    } else {
      warn(`${changed} uncommitted change(s)`);
    }
  } catch { /* skip */ }
} else {
  fail('Not a git repository', 'git init');
}

if (fs.existsSync(path.join(ROOT, '.husky'))) {
  pass('Husky hooks configured');
} else {
  warn('Husky hooks not found', 'npx husky init');
}

// 7. Environment
section('Environment');

const freeMB = Math.round(os.freemem() / (1024 * 1024));
if (freeMB >= 512) {
  pass(`Free memory: ${freeMB}MB`);
} else {
  warn(`Low memory: ${freeMB}MB (recommend ≥ 512MB)`);
}

const cpus = os.cpus().length;
pass(`CPU cores: ${cpus}`);

// ── Summary ──────────────────────────────────────────

console.log('\n' + bold('── Summary ──'));
console.log(`  ${green(`${passed} passed`)}, ${errors ? red(`${errors} failed`) : `${errors} failed`}, ${warnings ? yellow(`${warnings} warnings`) : `${warnings} warnings`}`);

if (errors > 0) {
  console.log(`\n${red('✗ Preflight check FAILED.')} Fix the issues above before proceeding.\n`);
  process.exit(1);
} else if (warnings > 0) {
  console.log(`\n${yellow('⚠ Preflight check passed with warnings.')}\n`);
  process.exit(0);
} else {
  console.log(`\n${green('✓ All preflight checks passed!')}\n`);
  process.exit(0);
}
