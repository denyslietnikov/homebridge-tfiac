import { vi, it, expect, describe, beforeEach, afterEach } from 'vitest';
import { DrySwitchAccessory } from '../DrySwitchAccessory.js';
import { PlatformAccessory, Service } from 'homebridge';
import { TfiacPlatform } from '../platform.js';
import { createMockApiActions, createMockCacheManager } from './testUtils';
import { OperationMode } from '../enums.js';

// Create mock implementations
vi.mock('../CacheManager.js', () => ({
  CacheManager: {
    getInstance: vi.fn(),
  },
  default: {
    getInstance: vi.fn(),
  },
}));

describe('DrySwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: any;
  let mockService: any;
  let inst: DrySwitchAccessory;
  let deviceAPI: any;
  let mockCacheManager: any;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Create platform mock
    platform = {
      log: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      api: {
        hap: {
          Service: {
            Switch: { UUID: 'switch-uuid' },
          },
          Characteristic: {
            On: 'On',
            Name: 'Name',
          },
        },
      },
      Service: {
        Switch: { UUID: 'switch-uuid' },
      },
      Characteristic: {
        On: 'On',
        Name: 'Name',
        ConfiguredName: 'ConfiguredName',
      },
      config: {},
    } as any;

    // Create mock service
    mockService = {
      setCharacteristic: vi.fn().mockReturnThis(),
      getCharacteristic: vi.fn().mockReturnValue({
        on: vi.fn(),
        onGet: vi.fn(),
        onSet: vi.fn(),
      }),
      updateCharacteristic: vi.fn(),
    };

    // Create mock accessory
    accessory = {
      getService: vi.fn().mockReturnValue(null), // Return null to force addService call
      getServiceById: vi.fn().mockReturnValue(null), // Return null to force addService call
      addService: vi.fn().mockReturnValue(mockService),
      context: {
        deviceConfig: {
          ip: '192.168.1.100',
          port: 8080,
          name: 'Test AC',
        },
      },
      displayName: 'Test AC',
      services: [mockService],
    };

    // Create API mock with methods for dry mode
    deviceAPI = createMockApiActions({ operation_mode: OperationMode.Cool });
    deviceAPI.setAirConditionerState = vi.fn().mockResolvedValue(undefined);
    
    // Create mock CacheManager
    mockCacheManager = createMockCacheManager(deviceAPI, { operation_mode: OperationMode.Cool });
  });

  function createAccessory() {
    inst = new DrySwitchAccessory(platform, accessory);
    // Override CacheManager to use our mock
    (inst as any).cacheManager = mockCacheManager;
    return inst;
  }

  it('should construct and set up polling and handlers', () => {
    createAccessory();
    expect(accessory.addService).toHaveBeenCalled();
    expect(mockService.setCharacteristic).toHaveBeenCalled();
    expect(mockService.getCharacteristic).toHaveBeenCalledWith('On');
  });

  it('should stop polling and cleanup', () => {
    createAccessory();
    inst.stopPolling();
    expect(mockCacheManager.cleanup).toHaveBeenCalled();
  });

  it('should update cached status and update characteristic', async () => {
    createAccessory();
    // Initialize with Cool mode
    inst.updateStatus({ operation_mode: OperationMode.Cool } as any);
    mockService.updateCharacteristic.mockClear();
    // Mock getStatus to return Dry mode, which should update the characteristic
    mockCacheManager.getStatus.mockResolvedValueOnce({ operation_mode: OperationMode.Dry });
    await (inst as any).updateCachedStatus();
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith('On', true);
  });

  it('should handle get with cached status (dry mode on)', () => {
    createAccessory();
    const callback = vi.fn();
    inst.updateStatus({ operation_mode: OperationMode.Dry } as any);
    inst['handleGet'](callback);
    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it('should handle get with cached status (dry mode off)', () => {
    createAccessory();
    const callback = vi.fn();
    inst.updateStatus({ operation_mode: OperationMode.Cool } as any);
    inst['handleGet'](callback);
    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it('should handle get with no cached status', () => {
    createAccessory();
    const callback = vi.fn();
    inst['handleGet'](callback);
    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it('should handle set (turn dry mode on) and update status', async () => {
    createAccessory();
    const callback = vi.fn();
    await (inst as any).handleSet(true, callback);
    expect(deviceAPI.setAirConditionerState).toHaveBeenCalledWith('operation_mode', OperationMode.Dry);
    expect(callback).toHaveBeenCalledWith(null);
  });

  it('should handle set (turn dry mode off) and update status', async () => {
    createAccessory();
    const callback = vi.fn();
    await (inst as any).handleSet(false, callback);
    expect(deviceAPI.setAirConditionerState).toHaveBeenCalledWith('operation_mode', OperationMode.Auto);
    expect(callback).toHaveBeenCalledWith(null);
  });

  it('should handle set error', async () => {
    createAccessory();
    const callback = vi.fn();
    const error = new Error('Network error');
    deviceAPI.setAirConditionerState.mockRejectedValue(error);
    await (inst as any).handleSet(true, callback);
    expect(deviceAPI.setAirConditionerState).toHaveBeenCalledWith('operation_mode', OperationMode.Dry);
    expect(callback).toHaveBeenCalledWith(error);
  });
});