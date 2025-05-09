import { vi, it, expect, describe, beforeEach, afterEach } from 'vitest';
import { TurboSwitchAccessory } from '../TurboSwitchAccessory.js';
import { PlatformAccessory, Service } from 'homebridge';
import { TfiacPlatform } from '../platform.js';
import { createMockApiActions, createMockCacheManager } from './testUtils';
import { FanSpeed, SleepModeState } from '../enums.js';

// Create mock implementations
vi.mock('../CacheManager.js', () => ({
  CacheManager: {
    getInstance: vi.fn(),
  },
  default: {
    getInstance: vi.fn(),
  },
}));

describe('TurboSwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: any;
  let mockService: any;
  let inst: TurboSwitchAccessory;
  let mockApiActions: any;
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
      config: {
        debug: false, // Add this property to fix the test
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

    // Create API mock with turbo methods
    mockApiActions = createMockApiActions({ opt_turbo: 'on' });
    mockApiActions.setTurboState = vi.fn().mockResolvedValue(undefined);
    
    // Create mock CacheManager
    mockCacheManager = createMockCacheManager(mockApiActions, { opt_turbo: 'on' });

    // No listener capture; tests will call updateStatus directly
  });

  function createAccessory() {
    inst = new TurboSwitchAccessory(platform, accessory);
    // Override CacheManager to use our mock
    (inst as any).cacheManager = mockCacheManager;
    return inst;
  }

  it('should initialize correctly', () => {
    createAccessory();
    expect(accessory.addService).toHaveBeenCalledWith(
      platform.Service.Switch,
      'Turbo',
      'turbo'
    );
    expect(mockService.setCharacteristic).toHaveBeenCalledWith(platform.Characteristic.Name, 'Turbo');
    expect(mockService.getCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On);
  });

  it('handles get characteristic with turbo on', () => {
    createAccessory();
    const callback = vi.fn();
    inst.updateStatus({ opt_turbo: 'on' } as any);
    
    (inst as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it('handles get characteristic with turbo off', () => {
    createAccessory();
    const callback = vi.fn();
    inst.updateStatus({ opt_turbo: 'off' } as any);
    
    (inst as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it('handles get characteristic with null status', () => {
    createAccessory();
    const callback = vi.fn();
    // Don't set status to test null case
    (inst as any).cachedStatus = null;
    
    (inst as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it('handles set characteristic to turn turbo on', async () => {
    createAccessory();
    const callback = vi.fn();
    await (inst as any).handleSet(true, callback);
    expect(mockApiActions.setTurboState).toHaveBeenCalledWith('on');
    // Don't expect clear() to be called in the new implementation
    expect(mockCacheManager.clear).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(null);
  });

  it('handles set characteristic to turn turbo off', async () => {
    createAccessory();
    const callback = vi.fn();
    
    // The mock API is injected into the cacheManager, so we need to set it there
    mockCacheManager.api.setFanAndSleepState = vi.fn().mockResolvedValue(undefined);
    
    // Inject our mock cache manager into the instance
    (inst as any).cacheManager = mockCacheManager;
    
    await (inst as any).handleSet(false, callback);
    
    // Check that setFanAndSleepState was called with Auto fan speed and sleep off
    expect(mockCacheManager.api.setFanAndSleepState).toHaveBeenCalledWith(FanSpeed.Auto, SleepModeState.Off);
    
    // Don't expect clear() to be called in the new implementation
    expect(mockCacheManager.clear).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(null);
  });

  it('handles set error', async () => {
    createAccessory();
    const callback = vi.fn();
    const error = new Error('Network error');
    mockApiActions.setTurboState.mockRejectedValueOnce(error);
    await (inst as any).handleSet(true, callback);
    expect(mockApiActions.setTurboState).toHaveBeenCalledWith('on');
    expect(callback).toHaveBeenCalledWith(error);
    expect(platform.log.error).toHaveBeenCalledWith(
      expect.stringContaining('Error setting Turbo'),
      error
    );
  });

  describe('Status Listener', () => {
    it('updates characteristic when turbo state changes from off to on', () => {
      createAccessory();
      inst.updateStatus({ opt_turbo: 'off' } as any);
      mockService.updateCharacteristic.mockClear();
      
      inst.updateStatus({ opt_turbo: 'on' } as any);
      
      expect(mockService.updateCharacteristic).toHaveBeenCalledWith('On', true);
    });

    it('updates characteristic when turbo state changes from on to off', () => {
      createAccessory();
      inst.updateStatus({ opt_turbo: 'on' } as any);
      mockService.updateCharacteristic.mockClear();
      
      inst.updateStatus({ opt_turbo: 'off' } as any);
      
      expect(mockService.updateCharacteristic).toHaveBeenCalledWith('On', false);
    });

    it('does not update characteristic if turbo state unchanged (on)', () => {
      createAccessory();
      inst.updateStatus({ opt_turbo: 'on' } as any);
      mockService.updateCharacteristic.mockClear();
      
      inst.updateStatus({ opt_turbo: 'on' } as any);
      
      expect(mockService.updateCharacteristic).not.toHaveBeenCalled();
    });

    it('does not update characteristic if turbo state unchanged (off)', () => {
      createAccessory();
      inst.updateStatus({ opt_turbo: 'off' } as any);
      mockService.updateCharacteristic.mockClear();
      
      inst.updateStatus({ opt_turbo: 'off' } as any);
      
      expect(mockService.updateCharacteristic).not.toHaveBeenCalled();
    });

    it('handles null status gracefully', () => {
      createAccessory();
      // Simulate receiving null status
      inst.updateStatus(null as any);
      
      // No crash should occur
      expect(true).toBe(true);
    });
  });

  it('stops polling and cleans up api', () => {
    createAccessory();
    inst.stopPolling();
    expect(mockCacheManager.cleanup).toHaveBeenCalled();
  });
});