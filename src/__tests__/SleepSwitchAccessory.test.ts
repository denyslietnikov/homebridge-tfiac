import { PlatformAccessory, Service } from 'homebridge';
import { TfiacPlatform } from '../platform.js';
import { SleepSwitchAccessory } from '../SleepSwitchAccessory.js';
import CacheManager from '../CacheManager.js';
import { SleepModeState } from '../enums.js'; // Import Enum
import { AirConditionerStatus } from '../AirConditionerAPI.js';
import { jest, beforeEach, describe, it, expect } from '@jest/globals';

// Mock the CacheManager
jest.mock('../CacheManager.js');

// Define mock function types explicitly
type MockFn<T> = jest.Mock<any>;

describe('SleepSwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: any; // Use 'any' instead of PlatformAccessory to avoid type issues
  let service: any;
  let inst: SleepSwitchAccessory;
  let mockCacheManager: any;
  // Mock functions with explicit types
  let mockSetSleepState: MockFn<(state: string) => Promise<void>>;
  let mockUpdateState: MockFn<() => Promise<{}>>;
  let mockGetStatus: MockFn<() => Promise<AirConditionerStatus>>;

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    
    // Create our mock functions with proper types
    mockSetSleepState = jest.fn<(state: string) => Promise<void>>();
    mockUpdateState = jest.fn<() => Promise<{}>>();
    mockGetStatus = jest.fn<() => Promise<AirConditionerStatus>>();
    
    // Create mock cache manager
    mockCacheManager = {
      api: {
        setSleepState: mockSetSleepState,
        updateState: mockUpdateState,
        setAirConditionerState: jest.fn(),
      },
      get: jest.fn(),
      set: jest.fn(),
      clear: jest.fn(),
      startPolling: jest.fn(),
      stopPolling: jest.fn(),
      getStatus: mockGetStatus,
      cleanup: jest.fn(),
    };
    
    // Mock the static getInstance method
    (CacheManager.getInstance as jest.Mock) = jest.fn().mockReturnValue(mockCacheManager);

    // Create platform mock
    platform = {
      log: {
        info: jest.fn(),
        debug: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
      },
      api: {
        hap: {
          uuid: {
            generate: jest.fn().mockReturnValue('mock-uuid'),
          },
          Characteristic: {
            On: {
              name: 'On',
            },
          },
        },
        platformAccessory: jest.fn(),
      },
      Service: {
        Switch: function() {
          return service;
        },
      },
      Characteristic: {
        On: 'On',
        Name: 'Name',
        ConfiguredName: 'ConfiguredName',
      },
      config: {},
    } as unknown as TfiacPlatform;

    // Create service mock with proper on and updateValue methods
    const mockOnMethod = jest.fn().mockReturnThis();
    const mockUpdateValue = jest.fn();
    const mockCharacteristic = {
      on: mockOnMethod,
      updateValue: mockUpdateValue,
    };
    
    service = {
      getCharacteristic: jest.fn().mockReturnValue(mockCharacteristic),
      setCharacteristic: jest.fn().mockReturnThis(),
      updateCharacteristic: jest.fn(),
    };

    // Create accessory mock
    accessory = {
      displayName: 'Test Accessory',
      UUID: 'test-uuid',
      context: {
        deviceConfig: {
          ip: '127.0.0.1',
          mac: 'AA:BB:CC:DD:EE:FF',
          pollInterval: 30,
          updateInterval: 30,
        }
      },
      services: [],
      getService: jest.fn().mockReturnValue(null),
      getServiceById: jest.fn().mockReturnValue(null),
      addService: jest.fn().mockImplementation(() => service),
      removeService: jest.fn(),
      on: jest.fn(),
      emit: jest.fn(),
    };

    // Create instance of the accessory
    inst = new SleepSwitchAccessory(platform, accessory);

    // Ensure the mock API is accessible via cacheManager
    (inst as any).cacheManager = mockCacheManager;
  });

  it('should initialize correctly', () => {
    expect(accessory.getServiceById).toHaveBeenCalled();
    expect(accessory.addService).toHaveBeenCalled();
    expect(service.setCharacteristic).toHaveBeenCalledWith('Name', 'Sleep');
    
    // Check getCharacteristic and on handlers are set up
    expect(service.getCharacteristic).toHaveBeenCalledWith('On');
    const mockCharacteristic = service.getCharacteristic('On');
    expect(mockCharacteristic.on).toHaveBeenCalledWith('get', expect.any(Function));
    expect(mockCharacteristic.on).toHaveBeenCalledWith('set', expect.any(Function));
  });

  describe('handleGet', () => {
    it('handles get characteristic with sleep mode on', () => {
      const callback = jest.fn();
      (inst as any).cachedStatus = { opt_sleepMode: SleepModeState.On };
      (inst as any).handleGet(callback);
      expect(callback).toHaveBeenCalledWith(null, true);
    });

    it('handles get characteristic with sleep mode off', () => {
      const callback = jest.fn();
      (inst as any).cachedStatus = { opt_sleepMode: SleepModeState.Off };
      (inst as any).handleGet(callback);
      expect(callback).toHaveBeenCalledWith(null, false);
    });

    it('handles get characteristic with undefined sleep mode', () => {
      const callback = jest.fn();
      (inst as any).cachedStatus = { opt_sleepMode: undefined };
      (inst as any).handleGet(callback);
      expect(callback).toHaveBeenCalledWith(null, true);
    });

    it('handles get characteristic with null status', () => {
      const callback = jest.fn();
      (inst as any).cachedStatus = null;
      (inst as any).handleGet(callback);
      expect(callback).toHaveBeenCalledWith(null, false);
    });
  });

  describe('handleSet', () => {
    it('should call setSleepState with SleepModeState.On when value is true', async () => {
      const callback = jest.fn();
      await (inst as any).handleSet(true, callback);
      expect(mockCacheManager.api.setSleepState).toHaveBeenCalledWith(SleepModeState.On);
      expect(mockCacheManager.clear).toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith(null);
    });

    it('should call setSleepState with SleepModeState.Off when value is false', async () => {
      const callback = jest.fn();
      await (inst as any).handleSet(false, callback);
      expect(mockCacheManager.api.setSleepState).toHaveBeenCalledWith(SleepModeState.Off);
      expect(mockCacheManager.clear).toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith(null);
    });

    it('should handle errors from setSleepState', async () => {
      const callback = jest.fn();
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