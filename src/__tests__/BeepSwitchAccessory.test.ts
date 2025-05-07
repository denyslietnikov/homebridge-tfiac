import { vi, it, expect, describe, beforeEach, afterEach } from 'vitest';
import { BeepSwitchAccessory } from '../BeepSwitchAccessory.js';
import { PlatformAccessory, Service } from 'homebridge';
import { TfiacPlatform } from '../platform.js';
import { createMockApiActions, createMockCacheManager } from './testUtils';

// Create mock implementations
vi.mock('../CacheManager.js', () => ({
  CacheManager: {
    getInstance: vi.fn(),
  },
  default: {
    getInstance: vi.fn(),
  },
}));

describe('BeepSwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: any;
  let mockService: any;
  let inst: BeepSwitchAccessory;
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

    // Create API mock with beep methods
    deviceAPI = createMockApiActions({ opt_beep: 'on' });
    deviceAPI.setBeepState = vi.fn().mockResolvedValue(undefined);
    
    // Create mock CacheManager
    mockCacheManager = createMockCacheManager(deviceAPI, { opt_beep: 'on' });
  });

  function createAccessory() {
    inst = new BeepSwitchAccessory(platform, accessory);
    // Override CacheManager to use our mock
    (inst as any).cacheManager = mockCacheManager;
    // Set initial cached status for tests
    (inst as any).cachedStatus = { opt_beep: 'on' };
    return inst;
  }

  it('should construct and set up polling and handlers', () => {
    createAccessory();
    expect(accessory.addService).toHaveBeenCalledWith(
      platform.Service.Switch,
      'Beep',
      'beep'
    );
    expect(mockService.setCharacteristic).toHaveBeenCalledWith(platform.Characteristic.Name, 'Beep');
    expect(mockService.getCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On);
  });

  it('should stop polling and cleanup', () => {
    createAccessory();
    inst.stopPolling();
    expect(mockCacheManager.cleanup).toHaveBeenCalled();
  });

  it('should update cached status and update characteristic', async () => {
    createAccessory();
    // Initialize with beep off
    (inst as any).cachedStatus = { opt_beep: 'off' };
    
    // Mock getStatus to return beep on, which should update the characteristic to true
    mockCacheManager.getStatus.mockResolvedValueOnce({ opt_beep: 'on' });
    
    await (inst as any).updateCachedStatus();
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith('On', true);
  });

  it('should handle get with cached status (beep on)', () => {
    createAccessory();
    const callback = vi.fn();
    mockCacheManager.getLastStatus.mockReturnValueOnce({ opt_beep: 'on' });
    (inst as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it('should handle get with cached status (beep off)', () => {
    createAccessory();
    const callback = vi.fn();
    mockCacheManager.getLastStatus.mockReturnValueOnce({ opt_beep: 'off' });
    (inst as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it('should handle get with no cached status', () => {
    createAccessory();
    const callback = vi.fn();
    mockCacheManager.getLastStatus.mockReturnValueOnce(null);
    (inst as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it('should handle set (turn beep on) and update status', async () => {
    createAccessory();
    const callback = vi.fn();
    await (inst as any).handleSet(true, callback);
    expect(deviceAPI.setBeepState).toHaveBeenCalledWith('on');
    expect(mockCacheManager.clear).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(null);
  });

  it('should handle set (turn beep off) and update status', async () => {
    createAccessory();
    const callback = vi.fn();
    await (inst as any).handleSet(false, callback);
    expect(deviceAPI.setBeepState).toHaveBeenCalledWith('off');
    expect(mockCacheManager.clear).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(null);
  });

  it('should handle set error', async () => {
    createAccessory();
    const callback = vi.fn();
    const error = new Error('Network error');
    deviceAPI.setBeepState.mockRejectedValue(error);
    await (inst as any).handleSet(true, callback);
    expect(deviceAPI.setBeepState).toHaveBeenCalledWith('on');
    expect(callback).toHaveBeenCalledWith(error);
  });
});