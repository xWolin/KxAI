#!/usr/bin/env node
/**
 * generate-changelog.js — Auto-generate CHANGELOG.md from git commits.
 *
 * Follows Conventional Commits convention:
 *   feat(scope): message   → ✨ New Features
 *   fix(scope): message    → 🐛 Bug Fixes
 *   perf(scope): message   → ⚡ Performance
 *   refactor(scope): message → ♻️ Refactoring
 *   docs(scope): message   → 📝 Documentation
 *   test(scope): message   → ✅ Tests
 *   chore(scope): message  → 🔧 Chores
 *
 * Usage:
 *   node scripts/generate-changelog.js           # Generate full changelog
 *   node scripts/generate-changelog.js --latest   # Only latest (unreleased) changes
 *   node scripts/generate-changelog.js --tag v0.2.0  # Changes since tag
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─── Config ───

const CATEGORIES = {
  feat: { emoji: '✨', title: 'New Features' },
  fix: { emoji: '🐛', title: 'Bug Fixes' },
  perf: { emoji: '⚡', title: 'Performance' },
  refactor: { emoji: '♻️', title: 'Refactoring' },
  docs: { emoji: '📝', title: 'Documentation' },
  test: { emoji: '✅', title: 'Tests' },
  chore: { emoji: '🔧', title: 'Chores' },
  ci: { emoji: '🔁', title: 'CI/CD' },
  style: { emoji: '🎨', title: 'Code Style' },
  build: { emoji: '📦', title: 'Build System' },
};

const COMMIT_PATTERN = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/;

// ─── Helpers ───

function git(cmd) {
  return execSync(`git ${cmd}`, { encoding: 'utf8' }).trim();
}

function getTags() {
  try {
    const tags = git('tag --list "v*" --sort=-version:refname');
    return tags ? tags.split('\n').filter(Boolean) : [];
  } catch {
    return [];
  }
}

function getCommits(from, to = 'HEAD') {
  const range = from ? `${from}..${to}` : to;
  const format = '%H|%s|%an|%ai';
  try {
    const raw = git(`log ${range} --pretty=format:"${format}" --no-merges`);
    if (!raw) return [];

    return raw.split('\n').filter(Boolean).map((line) => {
      const [hash, subject, author, date] = line.split('|');
      return { hash: hash.slice(0, 8), subject, author, date: date.slice(0, 10) };
    });
  } catch {
    return [];
  }
}

function parseCommit(commit) {
  const match = commit.subject.match(COMMIT_PATTERN);
  if (!match) {
    return { type: 'other', scope: null, breaking: false, message: commit.subject, ...commit };
  }

  const [, type, scope, breaking, message] = match;
  return {
    type: type.toLowerCase(),
    scope: scope || null,
    breaking: !!breaking,
    message,
    ...commit,
  };
}

function formatSection(title, emoji, commits) {
  if (commits.length === 0) return '';

  let section = `### ${emoji} ${title}\n\n`;
  for (const c of commits) {
    const scope = c.scope ? `**${c.scope}:** ` : '';
    const breaking = c.breaking ? '⚠️ BREAKING: ' : '';
    section += `- ${breaking}${scope}${c.message} (\`${c.hash}\`)\n`;
  }
  return section + '\n';
}

function generateVersion(tag, commits) {
  const dateStr = commits.length > 0 ? commits[0].date : new Date().toISOString().slice(0, 10);
  const versionLabel = tag || 'Unreleased';

  let output = `## ${versionLabel} (${dateStr})\n\n`;

  // Collect breaking changes
  const breaking = commits.filter((c) => c.breaking);
  if (breaking.length > 0) {
    output += '### ⚠️ Breaking Changes\n\n';
    for (const c of breaking) {
      const scope = c.scope ? `**${c.scope}:** ` : '';
      output += `- ${scope}${c.message} (\`${c.hash}\`)\n`;
    }
    output += '\n';
  }

  // Group by category
  for (const [type, config] of Object.entries(CATEGORIES)) {
    const typeCommits = commits.filter((c) => c.type === type);
    output += formatSection(config.title, config.emoji, typeCommits);
  }

  // "Other" for uncategorized
  const otherCommits = commits.filter(
    (c) => c.type === 'other' || !CATEGORIES[c.type],
  );
  if (otherCommits.length > 0) {
    output += formatSection('Other Changes', '📋', otherCommits);
  }

  return output;
}

// ─── Main ───

function main() {
  const args = process.argv.slice(2);
  const latestOnly = args.includes('--latest');
  const tagIndex = args.indexOf('--tag');
  const sinceTag = tagIndex !== -1 ? args[tagIndex + 1] : null;

  const tags = getTags();
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

  let changelog = `# KxAI Changelog\n\n`;
  changelog += `> Auto-generated from [Conventional Commits](https://www.conventionalcommits.org/).\n\n`;

  if (latestOnly || sinceTag) {
    // Only generate for latest/specific range
    const from = sinceTag || (tags.length > 0 ? tags[0] : null);
    const commits = getCommits(from).map(parseCommit);
    const label = sinceTag ? `Changes since ${sinceTag}` : `v${pkg.version} (Unreleased)`;
    changelog += generateVersion(label, commits);
  } else {
    // Full changelog: unreleased + all tagged versions
    // Unreleased
    if (tags.length > 0) {
      const unreleased = getCommits(tags[0]).map(parseCommit);
      if (unreleased.length > 0) {
        changelog += generateVersion(`v${pkg.version} (Unreleased)`, unreleased);
      }
    }

    // Tagged versions
    for (let i = 0; i < tags.length; i++) {
      const tag = tags[i];
      const from = i + 1 < tags.length ? tags[i + 1] : null;
      const commits = getCommits(from, tag).map(parseCommit);
      changelog += generateVersion(tag, commits);
    }

    // If no tags at all, show all commits
    if (tags.length === 0) {
      const commits = getCommits(null).map(parseCommit);
      changelog += generateVersion(`v${pkg.version}`, commits);
    }
  }

  // Write to file
  const outPath = path.join(__dirname, '..', 'CHANGELOG.md');
  fs.writeFileSync(outPath, changelog);
  console.log(`✅ Changelog written to ${outPath} (${changelog.split('\n').length} lines)`);
}

main();
