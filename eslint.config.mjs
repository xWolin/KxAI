import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  // Ignore patterns
  {
    ignores: ['dist/**', 'release/**', 'node_modules/**', 'scripts/**', '*.js', '*.mjs'],
  },

  // Base recommended rules
  eslint.configs.recommended,

  // TypeScript rules
  ...tseslint.configs.recommended,

  // Shared settings for all TS/TSX files
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      // TypeScript-specific
      '@typescript-eslint/no-explicit-any': 'off', // Too many any's in codebase, fix incrementally
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-require-imports': 'off', // Some dynamic requires in main process

      // General
      'no-console': 'off', // Logger migration is incremental
      'prefer-const': 'warn',
      'no-var': 'error',
      'eqeqeq': ['error', 'always'],
    },
  },

  // React/Renderer-specific rules
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // react-hooks v7 introduced overly strict new rules that conflict with valid
      // existing patterns in this codebase. Disable until incremental migration.
      'react-hooks/immutability': 'off', // flags function-before-hook ordering
      'react-hooks/set-state-in-effect': 'off', // flags valid async setState in effects
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // Main process — flag sync fs operations
  {
    files: ['src/main/**/*.ts'],
    rules: {
      // Warn on synchronous fs operations (migration target)
      'no-restricted-properties': ['warn',
        { object: 'fs', property: 'readFileSync', message: 'Use async fs.promises.readFile instead.' },
        { object: 'fs', property: 'writeFileSync', message: 'Use async fs.promises.writeFile instead.' },
        { object: 'fs', property: 'mkdirSync', message: 'Use async fs.promises.mkdir instead.' },
        { object: 'fs', property: 'existsSync', message: 'Use async fs.promises.access instead.' },
        { object: 'fs', property: 'readdirSync', message: 'Use async fs.promises.readdir instead.' },
        { object: 'fs', property: 'statSync', message: 'Use async fs.promises.stat instead.' },
        { object: 'fs', property: 'unlinkSync', message: 'Use async fs.promises.unlink instead.' },
        { object: 'fs', property: 'copyFileSync', message: 'Use async fs.promises.copyFile instead.' },
      ],
    },
  },
);
