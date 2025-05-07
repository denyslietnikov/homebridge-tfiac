import { PlatformAccessory, Service } from 'homebridge';
import { TfiacPlatform } from '../platform.js';
import { SleepSwitchAccessory } from '../SleepSwitchAccessory.js';
import CacheManager from '../CacheManager.js';
import { SleepModeState } from '../enums.js'; // Import Enum
import { AirConditionerStatus } from '../AirConditionerAPI.js';
import { vi, beforeEach, describe, it, expect  } from 'vitest';
import { createMockApiActions, createMockCacheManager, createMockPlatformAccessory } from './testUtils';

// Mock the CacheManager
vi.mock('../CacheManager.js');

// Define mock function types explicitly
type MockFn<T> = ReturnType<typeof vi.fn>;

describe('SleepSwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: any; // Use 'any' instead of PlatformAccessory to avoid type issues
  let mockService: any;
  let service: any;
  let inst: SleepSwitchAccessory;
  let deviceAPI: any;
  let mockCacheManager: any;
  let createAccessory: () => SleepSwitchAccessory;
  let initialMockStatus: any;

  // Set up test mocks
  beforeEach(() => {
    // Create mock platform
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

    initialMockStatus = {
      opt_sleepMode: SleepModeState.Off,
    };

    // Create mock service
    service = {
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
      getService: vi.fn().mockReturnValue(service),
      getServiceById: vi.fn().mockReturnValue(service),
      addService: vi.fn().mockReturnValue(service),
      context: {
        deviceConfig: {
          ip: '192.168.1.100',
          port: 8080,
          name: 'Test AC',
        },
      },
      displayName: 'Test AC',
      services: [service],
    };

    // Create mock device API
    deviceAPI = createMockApiActions(initialMockStatus);
    deviceAPI.setSleepState = vi.fn().mockResolvedValue(undefined);
    
    // Create mock CacheManager
    mockCacheManager = createMockCacheManager(deviceAPI, initialMockStatus);

    createAccessory = () => {
      inst = new SleepSwitchAccessory(platform, accessory);
      // Override CacheManager to use our mock
      (inst as any).cacheManager = mockCacheManager;
      (inst as any).cachedStatus = initialMockStatus;
      return inst;
    };

    // Create instance
    inst = createAccessory();
  });

  it('should initialize correctly', () => {
    expect(accessory.getServiceById).toHaveBeenCalled();
    expect(service.setCharacteristic).toHaveBeenCalledWith('Name', 'Sleep');
    
    // Check getCharacteristic and on handlers are set up
    expect(service.getCharacteristic).toHaveBeenCalledWith('On');
  });

  describe('handleGet', () => {
    it('handles get characteristic with sleep mode on', () => {
      const callback = vi.fn();
      mockCacheManager.getLastStatus.mockReturnValueOnce({ opt_sleepMode: SleepModeState.On });
      (inst as any).handleGet(callback);
      expect(callback).toHaveBeenCalledWith(null, true);
    });

    it('handles get characteristic with sleep mode off', () => {
      const callback = vi.fn();
      mockCacheManager.getLastStatus.mockReturnValueOnce({ opt_sleepMode: SleepModeState.Off });
      (inst as any).handleGet(callback);
      expect(callback).toHaveBeenCalledWith(null, false);
    });

    it('handles get characteristic with undefined sleep mode', () => {
      const callback = vi.fn();
      mockCacheManager.getLastStatus.mockReturnValueOnce({ opt_sleepMode: undefined });
      (inst as any).handleGet(callback);
      expect(callback).toHaveBeenCalledWith(null, false);
    });

    it('handles get characteristic with null status', () => {
      const callback = vi.fn();
      mockCacheManager.getLastStatus.mockReturnValueOnce(null);
      (inst as any).handleGet(callback);
      expect(callback).toHaveBeenCalledWith(null, false);
    });
  });

  describe('handleSet', () => {
    it('should call setSleepState with SleepModeState.On when value is true', async () => {
      const callback = vi.fn();
      await (inst as any).handleSet(true, callback);
      expect(mockCacheManager.api.setSleepState).toHaveBeenCalledWith(SleepModeState.On);
      expect(mockCacheManager.clear).toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith(null);
    });

    it('should call setSleepState with SleepModeState.Off when value is false', async () => {
      const callback = vi.fn();
      await (inst as any).handleSet(false, callback);
      expect(mockCacheManager.api.setSleepState).toHaveBeenCalledWith(SleepModeState.Off);
      expect(mockCacheManager.clear).toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith(null);
    });

    it('should handle errors from setSleepState', async () => {
      const callback = vi.fn();
      const error = new Error('API Error');
      mockCacheManager.api.setSleepState.mockRejectedValue(error);
      await (inst as any).handleSet(true, callback);
      expect(mockCacheManager.api.setSleepState).toHaveBeenCalledWith(SleepModeState.On);
      expect(mockCacheManager.clear).not.toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith(error);
    });
  });

  describe('updateCachedStatus', () => {
    it('updateCachedStatus updates characteristic when opt_sleepMode changes from off to on', async () => {
      (inst as any).cachedStatus = { opt_sleepMode: SleepModeState.Off };
      mockCacheManager.getStatus.mockResolvedValueOnce({ opt_sleepMode: SleepModeState.On });
      await (inst as any).updateCachedStatus();
      // BaseSwitchAccessory uses updateCharacteristic, not updateValue
      expect(service.updateCharacteristic).toHaveBeenCalledWith('On', true);
    });

    it('updateCachedStatus updates characteristic when opt_sleepMode changes from on to off', async () => {
      (inst as any).cachedStatus = { opt_sleepMode: SleepModeState.On };
      mockCacheManager.getStatus.mockResolvedValueOnce({ opt_sleepMode: SleepModeState.Off });
      await (inst as any).updateCachedStatus();
      // BaseSwitchAccessory uses updateCharacteristic, not updateValue
      expect(service.updateCharacteristic).toHaveBeenCalledWith('On', false);
    });

    it('updateCachedStatus does not update characteristic if opt_sleepMode unchanged (on)', async () => {
      (inst as any).cachedStatus = { opt_sleepMode: SleepModeState.On };
      mockCacheManager.getStatus.mockResolvedValueOnce({ opt_sleepMode: SleepModeState.On });
      await (inst as any).updateCachedStatus();
      expect(service.updateCharacteristic).not.toHaveBeenCalled();
    });

    it('updateCachedStatus does not update characteristic if opt_sleepMode unchanged (off)', async () => {
      (inst as any).cachedStatus = { opt_sleepMode: SleepModeState.Off };
      mockCacheManager.getStatus.mockResolvedValueOnce({ opt_sleepMode: SleepModeState.Off });
      await (inst as any).updateCachedStatus();
      expect(service.updateCharacteristic).not.toHaveBeenCalled();
    });

    it('updateCachedStatus handles error from getStatus', async () => {
      const error = new Error('fail');
      mockCacheManager.getStatus.mockRejectedValueOnce(error);
      await (inst as any).updateCachedStatus();
      expect(platform.log.error).toHaveBeenCalledWith(
        expect.stringContaining('Error updating Sleep status for'),
        error,
      );
      expect(service.updateCharacteristic).not.toHaveBeenCalled();
    });
  });
});