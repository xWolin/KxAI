import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'release'],
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/main/services/**'],
      exclude: ['src/main/services/dashboard-spa.html'],
      thresholds: {
        // Minimum coverage for safety-critical services
        // Increase as test coverage grows
        lines: 30,
        functions: 25,
        branches: 20,
        statements: 30,
      },
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@main': path.resolve(__dirname, 'src/main'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
    },
  },
});
