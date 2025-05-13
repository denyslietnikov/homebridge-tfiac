// src/__tests__/setupTests.helper.ts
import { vi, beforeEach, afterEach } from 'vitest';

declare global {
  // eslint-disable-next-line no-var
  var MockApiActions: Record<string, unknown>;
  // eslint-disable-next-line no-var
  var jest: typeof vi;
}

// Globally available mock functions
globalThis.MockApiActions = {};

// Ensure compatibility with code that still uses jest
// This helps with cases where automatic replacement didn't work
globalThis.jest = vi;

// Set a higher default timeout value (15 seconds)
vi.setConfig({ testTimeout: 15000 });

// Automatically clear all mocks after each test
afterEach(() => {
  vi.clearAllMocks();
  // Use the correct method clearAllTimers instead of resetAllTimers
  vi.clearAllTimers();
});

// Equivalent to jest.useFakeTimers()
beforeEach(() => {
  vi.useFakeTimers();
});

// Equivalent to jest.useRealTimers()
afterEach(() => {
  vi.useRealTimers();
});

// No longer need these compatibility hacks as they're causing issues
// The compatibility is now handled by the globals: true in vite.config.ts