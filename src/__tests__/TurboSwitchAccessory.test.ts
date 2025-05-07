import { vi, it, expect, describe, beforeEach, afterEach } from 'vitest';
import { TurboSwitchAccessory } from '../TurboSwitchAccessory.js';
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
    mockCacheManager.getLastStatus.mockReturnValueOnce({ opt_turbo: 'on' });
    (inst as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it('handles get characteristic with turbo off', () => {
    createAccessory();
    const callback = vi.fn();
    mockCacheManager.getLastStatus.mockReturnValueOnce({ opt_turbo: 'off' });
    (inst as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it('handles get characteristic with null status', () => {
    createAccessory();
    const callback = vi.fn();
    mockCacheManager.getLastStatus.mockReturnValueOnce(null);
    (inst as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it('handles set characteristic to turn turbo on', async () => {
    createAccessory();
    const callback = vi.fn();
    await (inst as any).handleSet(true, callback);
    expect(mockApiActions.setTurboState).toHaveBeenCalledWith('on');
    expect(mockCacheManager.clear).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(null);
  });

  it('handles set characteristic to turn turbo off', async () => {
    createAccessory();
    const callback = vi.fn();
    await (inst as any).handleSet(false, callback);
    expect(mockApiActions.setTurboState).toHaveBeenCalledWith('off');
    expect(mockCacheManager.clear).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(null);
  });

  it('handles set error', async () => {
    createAccessory();
    const callback = vi.fn();
    const error = new Error('Network error');
    mockApiActions.setTurboState.mockRejectedValue(error);
    await (inst as any).handleSet(true, callback);
    expect(mockApiActions.setTurboState).toHaveBeenCalledWith('on');
    expect(callback).toHaveBeenCalledWith(error);
  });

  it('handles get characteristic with null cached status', () => {
    createAccessory();
    (inst as any).cachedStatus = null;
    const callback = vi.fn();
    mockCacheManager.getLastStatus.mockReturnValueOnce(null);
    (inst as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it('should updateStatus and update On characteristic when turbo state changes', async () => {
    createAccessory();
    (inst as any).cachedStatus = { opt_turbo: 'off' };
    mockCacheManager.getStatus.mockResolvedValueOnce({ opt_turbo: 'on' });
    await (inst as any).updateCachedStatus();
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith('On', true);
  });

  it('stops polling and cleans up api', () => {
    createAccessory();
    inst.stopPolling();
    expect(mockCacheManager.cleanup).toHaveBeenCalled();
  });
});