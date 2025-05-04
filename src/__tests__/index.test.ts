// index.test.ts

import { vi, describe, it, expect, Mock } from 'vitest';
import { PLATFORM_NAME } from '../settings.js';
import { TfiacPlatform } from '../platform.js';
import { API } from 'homebridge';

// Mock the homebridge API with the required properties
const mockAPI = {
  registerPlatform: vi.fn(),
  version: '1.0.0',
  serverVersion: '1.0.0',
  user: {
    storagePath: vi.fn(),
  },
  hap: {},
  on: vi.fn(),
  unregisterPlatformAccessories: vi.fn(),
  registerPlatformAccessories: vi.fn(),
  updatePlatformAccessories: vi.fn(),
  platformAccessory: vi.fn(),
  publishExternalAccessories: vi.fn(),
  registerAccessory: vi.fn(),
} as unknown as API;

describe('Homebridge Plugin Entry Point', () => {
  it('registers the platform with Homebridge', async () => {
    // Import the module to trigger the default export function
    const indexModule = await import('../index.js');
    
    // Call the default export function with the mock API
    indexModule.default(mockAPI);
    
    // Verify that registerPlatform was called with the correct arguments
    expect(mockAPI.registerPlatform).toHaveBeenCalledWith(
      PLATFORM_NAME,
      expect.any(Function)
    );
    
    // Verify that the second argument is our platform constructor
    // Use type assertion to access the mock property
    const platformArg = (mockAPI.registerPlatform as Mock).mock.calls[0][1];
    expect(platformArg).toBe(TfiacPlatform);
  });
});