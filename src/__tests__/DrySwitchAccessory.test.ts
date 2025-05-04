import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest';
import { DrySwitchAccessory } from '../DrySwitchAccessory.js';
import { CharacteristicGetCallback, CharacteristicSetCallback, PlatformAccessory, Service } from 'homebridge';
import { TfiacPlatform } from '../platform.js';
import {
  createMockLogger,
  createMockService,
  createMockPlatformAccessory,
  MockApiActions,
  createMockApiActions,
  setupTestPlatform,
  createMockAPI,
} from './testUtils.js';

import AirConditionerAPI from '../AirConditionerAPI.js';
import CacheManager from '../CacheManager.js';

// Mock AirConditionerAPI at the module level
vi.mock('../AirConditionerAPI.js', () => ({
  __esModule: true,
  default: vi.fn(() => MockApiActions),
}));

describe('DrySwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let mockService: ReturnType<typeof createMockService>;
  let mockOnCharacteristic: { onGet: ReturnType<typeof vi.fn>; onSet: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn>; updateValue: ReturnType<typeof vi.fn> };
  let deviceAPI: MockApiActions;
  let inst: DrySwitchAccessory;

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear CacheManager singletons so overrides apply
    (CacheManager as any).instances.clear();

    // Create mock API with HAP components
    const mockAPI = createMockAPI();
    
    // Create platform with mock API properly injected
    platform = setupTestPlatform({}, undefined, mockAPI);
    
    mockService = createMockService();
    mockOnCharacteristic = {
      onGet: vi.fn().mockReturnThis(),
      onSet: vi.fn().mockReturnThis(),
      on: vi.fn().mockReturnThis(), 
      updateValue: vi.fn().mockReturnThis(), 
    };
    mockService.getCharacteristic.mockImplementation((characteristic: any) => {
      // Check for both characteristic class/constructor reference and string representation
      const charId = typeof characteristic === 'string' ? characteristic : 
                    (characteristic && typeof characteristic === 'object' && 'On' in characteristic) ? 'On' : null;
                    
      if (charId === 'On' || characteristic === mockAPI.hap.Characteristic.On) {
        return mockOnCharacteristic;
      }
      // Return a generic mock for other characteristics
      return {
        onGet: vi.fn().mockReturnThis(),
        onSet: vi.fn().mockReturnThis(),
        on: vi.fn().mockReturnThis(),
        updateValue: vi.fn().mockReturnThis(),
      };
    });

    const deviceConfig = { name: 'Test AC', ip: '192.168.1.100', port: 7777, updateInterval: 1 };
    
    accessory = createMockPlatformAccessory(
      'Test Dry Switch',
      'uuid-dry',
      deviceConfig,
      mockService,
    );

    accessory.getService = vi.fn().mockReturnValue(undefined);
    accessory.getServiceById = vi.fn().mockReturnValue(undefined);
    accessory.addService = vi.fn().mockImplementation(() => mockService as unknown as Service);

    // Create mock API actions using the helper function
    deviceAPI = createMockApiActions({ operation_mode: 'auto' });
    
    // Make sure the mock is properly set
    (AirConditionerAPI as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => deviceAPI);
  });

  afterEach(() => {
    if (inst) {
      inst.stopPolling();
    }
    vi.clearAllMocks();
  });

  const createAccessory = () => {
    inst = new DrySwitchAccessory(platform, accessory);
    // Override CacheManager to use our mock API
    (inst as any).cacheManager.api = deviceAPI;
    (inst as any).cacheManager.clear();
    return inst;
  };

  it('should construct and set up polling and handlers', () => {
    createAccessory();
    // getService is called with "Dry" in BaseSwitchAccessory.constructor
    expect(accessory.addService).toHaveBeenCalled();
    // Name is now set in BaseSwitchAccessory constructor only
    expect(mockService.setCharacteristic).toHaveBeenCalled();
    expect(mockService.getCharacteristic).toHaveBeenCalled();
    
    // Check that either onGet/onSet or on('get')/on('set') was called, but not both
    if (mockOnCharacteristic.onGet.mock.calls.length > 0) {
      expect(mockOnCharacteristic.onGet).toHaveBeenCalledWith(expect.any(Function));
      expect(mockOnCharacteristic.onSet).toHaveBeenCalledWith(expect.any(Function));
    } else {
      expect(mockOnCharacteristic.on).toHaveBeenCalledWith('get', expect.any(Function));
      expect(mockOnCharacteristic.on).toHaveBeenCalledWith('set', expect.any(Function));
    }
  });

  it('should stop polling and cleanup', () => {
    createAccessory();
    inst.stopPolling();
    expect(deviceAPI.cleanup).toHaveBeenCalled();
  });

  it('should update cached status and update characteristic', async () => {
    inst = new DrySwitchAccessory(platform, accessory);
    // Override CacheManager to use our mock API
    (inst as any).cacheManager.api = deviceAPI;
    (inst as any).cacheManager.clear();
     
    // Clear mocks specifically for updateCharacteristic after constructor might have called it
    mockService.updateCharacteristic.mockClear();
    (inst as any).cachedStatus = { operation_mode: 'dehumi' }; // Set initial different state

    // Update the mock response to have operation_mode: 'auto'
    deviceAPI.updateState.mockResolvedValueOnce({ operation_mode: 'auto' });

    await (inst as any).updateCachedStatus();
    expect(deviceAPI.updateState).toHaveBeenCalled();
    // Expect characteristic to be updated
    expect(mockService.updateCharacteristic).toHaveBeenCalled();
  });

  it('should handle get with cached status (dry mode on)', async () => {
    createAccessory();
    (inst as any).cachedStatus = { operation_mode: 'dehumi' };
    await new Promise<void>((resolve) => {
      (inst as any).handleGet((err: Error | null, val?: boolean) => {
        expect(err).toBeNull();
        expect(val).toBe(true);
        resolve();
      });
    });
  });

  it('should handle get with cached status (dry mode off)', async () => {
    createAccessory();
    (inst as any).cachedStatus = { operation_mode: 'auto' };
    await new Promise<void>((resolve) => {
      (inst as any).handleGet((err: Error | null, val?: boolean) => {
        expect(err).toBeNull();
        expect(val).toBe(false);
        resolve();
      });
    });
  });

  it('should handle get with no cached status', async () => {
    createAccessory();
    (inst as any).cachedStatus = null;
    await new Promise<void>((resolve) => {
      (inst as any).handleGet((err: Error | null, val?: boolean) => {
        expect(err).toBeNull();
        expect(val).toBe(false);
        resolve();
      });
    });
  });

  it('should handle set (turn dry mode on) and update status', async () => {
    createAccessory();
    const cb = vi.fn();
    deviceAPI.setAirConditionerState.mockResolvedValueOnce(undefined);
    await (inst as any).handleSet(true, cb);
    expect(deviceAPI.setAirConditionerState).toHaveBeenCalledWith('operation_mode', 'dehumi');
    expect(cb).toHaveBeenCalledWith(null);
    expect(mockService.updateCharacteristic).toHaveBeenCalled();
  });

  it('should handle set (turn dry mode off) and update status', async () => {
    createAccessory();
    const cb = vi.fn();
    deviceAPI.setAirConditionerState.mockResolvedValueOnce(undefined);
    await (inst as any).handleSet(false, cb);
    expect(deviceAPI.setAirConditionerState).toHaveBeenCalledWith('operation_mode', 'auto');
    expect(cb).toHaveBeenCalledWith(null);
    expect(mockService.updateCharacteristic).toHaveBeenCalled();
  });

  it('should handle set error', async () => {
    createAccessory();
    const error = new Error('API Error');
    deviceAPI.setAirConditionerState.mockRejectedValueOnce(error);
    const cb = vi.fn();
    await (inst as any).handleSet(true, cb);
    expect(deviceAPI.setAirConditionerState).toHaveBeenCalledWith('operation_mode', 'dehumi');
    expect(cb).toHaveBeenCalledWith(error);
    expect(mockService.updateCharacteristic).not.toHaveBeenCalledWith(expect.anything(), true);
  });
});