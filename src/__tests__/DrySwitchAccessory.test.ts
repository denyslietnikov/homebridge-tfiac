import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';
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
jest.mock('../AirConditionerAPI.js', () => {
  return jest.fn();
}, { virtual: true });

describe('DrySwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let mockService: ReturnType<typeof createMockService>;
  let mockOnCharacteristic: { onGet: jest.Mock; onSet: jest.Mock; on: jest.Mock; updateValue: jest.Mock };
  let deviceAPI: MockApiActions;
  let inst: DrySwitchAccessory;

  beforeEach(() => {
    jest.clearAllMocks();
    // Clear CacheManager singletons so overrides apply
    (CacheManager as any).instances.clear();

    // Create mock API with HAP components
    const mockAPI = createMockAPI();
    
    // Create platform with mock API properly injected
    platform = setupTestPlatform({}, undefined, mockAPI);
    
    mockService = createMockService();
    mockOnCharacteristic = {
      onGet: jest.fn().mockReturnThis(),
      onSet: jest.fn().mockReturnThis(),
      on: jest.fn().mockReturnThis(), 
      updateValue: jest.fn().mockReturnThis(), 
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
        onGet: jest.fn().mockReturnThis(),
        onSet: jest.fn().mockReturnThis(),
        on: jest.fn().mockReturnThis(),
        updateValue: jest.fn().mockReturnThis(),
      };
    });

    const deviceConfig = { name: 'Test AC', ip: '192.168.1.100', port: 7777, updateInterval: 1 };
    
    accessory = createMockPlatformAccessory(
      'Test Dry Switch',
      'uuid-dry',
      deviceConfig,
      mockService,
    );

    accessory.getService = jest.fn<typeof accessory.getService>().mockReturnValue(undefined);
    accessory.getServiceById = jest.fn<typeof accessory.getServiceById>().mockReturnValue(undefined);
    accessory.addService = jest.fn().mockImplementation(() => mockService as unknown as Service) as typeof accessory.addService;

    // Create mock API actions using the helper function
    deviceAPI = createMockApiActions({ operation_mode: 'auto' });
    
    // Make sure the mock is properly set
    (AirConditionerAPI as unknown as jest.Mock).mockImplementation(() => deviceAPI);
  });

  afterEach(() => {
    if (inst) {
      inst.stopPolling();
    }
    jest.clearAllMocks();
  });

  const createAccessory = () => {
    inst = new DrySwitchAccessory(platform, accessory);
    // Override CacheManager to use our mock API
    (inst as any).cacheManager.api = deviceAPI;
    (inst as any).cacheManager.clear();
    return inst;
  };

  it('should construct and set up polling and handlers', () => {
    inst = new DrySwitchAccessory(platform, accessory);
    // Manually inject our mock API into the instance
    (inst as any).deviceAPI = deviceAPI;
    
    // getService is called with "Dry" in BaseSwitchAccessory.constructor
    expect(accessory.addService).toHaveBeenCalled();
    expect(mockService.updateCharacteristic).toHaveBeenCalled();
    expect(mockService.getCharacteristic).toHaveBeenCalled();
    expect(mockOnCharacteristic.on).toHaveBeenCalledWith('get', expect.any(Function));
    expect(mockOnCharacteristic.on).toHaveBeenCalledWith('set', expect.any(Function));
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

  it('should handle get with cached status (dry mode on)', done => {
    createAccessory();
    (inst as any).cachedStatus = { operation_mode: 'dehumi' };
    (inst as any).handleGet((err: Error | null, val?: boolean) => {
      expect(err).toBeNull();
      expect(val).toBe(true);
      done();
    });
  });

  it('should handle get with cached status (dry mode off)', done => {
    createAccessory();
    (inst as any).cachedStatus = { operation_mode: 'auto' };
    (inst as any).handleGet((err: Error | null, val?: boolean) => {
      expect(err).toBeNull();
      expect(val).toBe(false);
      done();
    });
  });

  it('should handle get with no cached status', done => {
    createAccessory();
    (inst as any).cachedStatus = null;
    (inst as any).handleGet((err: Error | null, val?: boolean) => {
      expect(err).toBeNull();
      expect(val).toBe(false);
      done();
    });
  });

  it('should handle set (turn dry mode on) and update status', async () => {
    createAccessory();
    const cb = jest.fn() as CharacteristicSetCallback;
    deviceAPI.setAirConditionerState.mockResolvedValueOnce(undefined);
    await (inst as any).handleSet(true, cb);
    expect(deviceAPI.setAirConditionerState).toHaveBeenCalledWith('operation_mode', 'dehumi');
    expect(cb).toHaveBeenCalledWith(null);
    expect(mockService.updateCharacteristic).toHaveBeenCalled();
  });

  it('should handle set (turn dry mode off) and update status', async () => {
    createAccessory();
    const cb = jest.fn() as CharacteristicSetCallback;
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
    const cb = jest.fn() as CharacteristicSetCallback;
    await (inst as any).handleSet(true, cb);
    expect(deviceAPI.setAirConditionerState).toHaveBeenCalledWith('operation_mode', 'dehumi');
    expect(cb).toHaveBeenCalledWith(error);
    expect(mockService.updateCharacteristic).not.toHaveBeenCalledWith(expect.anything(), true);
  });
});