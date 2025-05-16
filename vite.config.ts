// vite.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      { find: '@jest/globals', replacement: 'vitest' },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    exclude: ['src/__tests__/setupTests.ts', 'src/__tests__/testUtils.ts'],
    setupFiles: ['src/__tests__/setupTests.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
      exclude: [
        '**/node_modules/**',
        '**/__tests__/**',
        '**/*.d.ts',
        '**/*.html',    // Exclude HTML artifacts
        '**/fix-deprecations.js',
        '**/eslint.config.js',
        '**/vite.config.ts',  // Trailing comma added
        './src/state/index.ts',
      ],
    },
    mockReset: true,
    restoreMocks: true,
    clearMocks: true,
    // Use isolated environment for each test
    isolate: true,
    // Test timeout parameters (in milliseconds)
    testTimeout: 15000,
    // Add aliases for imports
    alias: {
      '@': '/src',
    },
    // Handle virtual modules
    server: {
      deps: {
        inline: ['homebridge', /xml2js/],
      },
    },
  },
});