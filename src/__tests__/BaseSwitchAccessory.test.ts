import { vi, it, expect, describe, beforeEach, afterEach } from 'vitest';
import { PlatformAccessory, Service, Characteristic, CharacteristicValue, CharacteristicSetCallback } from 'homebridge';
import { TfiacDeviceConfig } from '../settings.js';
import { AirConditionerStatus } from '../AirConditionerAPI.js';
import { createMockCacheManager } from './testUtils';

// Mock implementations before imports to avoid hoisting issues
vi.mock('../AirConditionerAPI.js', () => {
  return {
    AirConditionerAPI: vi.fn(),
  };
}); 

vi.mock('../CacheManager.js', () => {
  return {
    CacheManager: {
      getInstance: vi.fn(),
    }
  };
});

// Import after mocks
import { TfiacPlatform } from '../platform.js';
import { BaseSwitchAccessory } from '../BaseSwitchAccessory.js';
import { CacheManager } from '../CacheManager.js';

// Define the TestSwitchAccessory class for testing
class TestSwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
    getStatusValueFn?: (status: Partial<AirConditionerStatus>) => boolean,
    setApiStateFn?: (value: boolean) => Promise<void>
  ) {
    const getStatusValue = getStatusValueFn || ((status: Partial<AirConditionerStatus>) => {
      // Using a type assertion because this is just a test helper
      return (status as any).opt_test === 'on';
    });
    const setApiState = setApiStateFn || (async (value: boolean) => {
      // Default empty implementation
    });

    super(
      platform,
      accessory,
      'Test Switch',
      'testswitch',
      getStatusValue,
      setApiState,
      'Test Switch' // Need to explicitly set the logPrefix
    );

    // Override the CacheManager with our mock version
    this.cacheManager = {
      getStatus: vi.fn().mockResolvedValue(null),
      getLastStatus: vi.fn().mockReturnValue(null),
      clear: vi.fn(),
      cleanup: vi.fn(),
      api: { 
        on: vi.fn(), 
        off: vi.fn(),
        emit: vi.fn(),
        // Other required properties for the AirConditionerAPI
        ip: '192.168.1.100',
        port: 8080,
        available: true,
        lastSeq: 0,
        setTurboState: vi.fn(),
        setBeepState: vi.fn(),
        setDisplayState: vi.fn(),
        setAirConditionerState: vi.fn(),
        turnOn: vi.fn(),
        turnOff: vi.fn(),
        updateState: vi.fn(),
        setSwingMode: vi.fn(),
        setFanSpeed: vi.fn(),
        setSleepState: vi.fn(),
        setEcoState: vi.fn(),
        cleanup: vi.fn()
      } as any
    } as unknown as CacheManager;
  }

  public handleGet(callback?: (error: Error | null, value?: boolean) => void): boolean {
    return super.handleGet(callback);
  }

  public async handleSet(value: CharacteristicValue, callback?: CharacteristicSetCallback): Promise<void> {
    await super.handleSet(value, callback as any);
  }

  public async updateCachedStatus(): Promise<void> {
    return super.updateCachedStatus();
  }
}

describe('BaseSwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let service: Service;
  let characteristic: Characteristic;
  let mockGetStatusValue: ReturnType<typeof vi.fn>;
  let mockSetApiState: ReturnType<typeof vi.fn>;
  let mockCacheManager: any;
  let inst: TestSwitchAccessory;

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();

    // Mock Characteristic
    characteristic = {
      on: vi.fn().mockReturnThis(),
      updateValue: vi.fn(),
    } as unknown as Characteristic;

    // Mock Service
    service = {
      getCharacteristic: vi.fn().mockReturnValue(characteristic),
      setCharacteristic: vi.fn().mockReturnThis(),
      updateCharacteristic: vi.fn(),
    } as unknown as Service;

    // Mock Accessory
    accessory = {
      getService: vi.fn().mockReturnValue(service),
      getServiceById: vi.fn().mockReturnValue(service),
      addService: vi.fn().mockReturnValue(service),
      context: {
        deviceConfig: {
          ip: '192.168.1.100',
          port: 8080,
          name: 'Test AC',
          updateInterval: 10,
        } as TfiacDeviceConfig,
      },
      displayName: 'Test AC Display Name',
    } as unknown as PlatformAccessory;

    // Mock Platform
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
            Switch: vi.fn(),
          },
          Characteristic: {
            On: vi.fn(),
            Name: vi.fn(),
          },
        },
      },
      Service: {
        Switch: {
          UUID: 'switch-uuid',
        },
      },
      Characteristic: {
        On: 'On',
        Name: 'Name',
      },
    } as unknown as TfiacPlatform;

    // Mock CacheManager
    // Ensure getInstance returns a mock with the getStatus method and api event methods
    mockCacheManager = {
      getStatus: vi.fn().mockResolvedValue(null),
      getLastStatus: vi.fn().mockReturnValue(null),
      clear: vi.fn(),
      cleanup: vi.fn(),
      api: { 
        on: vi.fn(), 
        off: vi.fn(),
        emit: vi.fn()
      }
    };
    
    (CacheManager.getInstance as ReturnType<typeof vi.fn>).mockReturnValue(mockCacheManager);

    // Mock functions for the constructor
    mockGetStatusValue = vi.fn().mockImplementation((status) => status.opt_test === 'on');
    mockSetApiState = vi.fn().mockResolvedValue(undefined);

    // Create instance of the test class
    inst = new TestSwitchAccessory(
      platform,
      accessory,
      mockGetStatusValue,
      mockSetApiState
    );
    
    // Replace the cacheManager with our mock
    (inst as any).cacheManager = mockCacheManager;
    
    // Prevent actual polling during tests
    inst.stopPolling();
    (inst as any).pollingInterval = null; // Ensure interval is cleared
  });

  it('should initialize correctly', () => {
    expect(accessory.getServiceById).toHaveBeenCalledWith(platform.Service.Switch.UUID, 'testswitch');
    expect(service.setCharacteristic).toHaveBeenCalledWith(platform.Characteristic.Name, 'Test Switch');
    expect(service.getCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On);
    expect(characteristic.on).toHaveBeenCalledWith('get', expect.any(Function));
    expect(characteristic.on).toHaveBeenCalledWith('set', expect.any(Function));
    // Update to match the actual log message format
    expect(platform.log.debug).toHaveBeenCalledWith(
      expect.stringContaining('Test Switch accessory initialized for Test AC Display Name')
    );
  });

  describe('handleGet', () => {
    it('should return false when cachedStatus is null', async () => {
      (inst as any).cachedStatus = null;
      const callback = vi.fn();
      await inst.handleGet(callback);
      expect(mockGetStatusValue).not.toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith(null, false);
    });

    it('should return value from getStatusValue when cachedStatus exists', async () => {
      // Set up our mocks correctly
      mockCacheManager.getLastStatus.mockReturnValue({ opt_test: 'on' });
      
      // Make sure the mock function returns the expected value
      mockGetStatusValue.mockReturnValue(true);
      
      const callback = vi.fn();
      inst.handleGet(callback);
      
      // The test shouldn't expect mockGetStatusValue to be called with the cached status
      // because in handleGet we use getLastStatus from the cacheManager instead of the instance variable
      expect(mockCacheManager.getLastStatus).toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith(null, true);

      // Test the opposite case
      vi.clearAllMocks();
      mockCacheManager.getLastStatus.mockReturnValue({ opt_test: 'off' });
      mockGetStatusValue.mockReturnValue(false);
      
      const callback2 = vi.fn();
      inst.handleGet(callback2);
      expect(mockCacheManager.getLastStatus).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledWith(null, false);
    });
  });

  describe('handleSet', () => {
    it('should call setApiState and update characteristic', async () => {
      const callback = vi.fn();
      await inst.handleSet(true, callback);
      expect(mockSetApiState).toHaveBeenCalledWith(true);
      expect(mockCacheManager.clear).toHaveBeenCalled();
      expect(service.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, true);
      expect(callback).toHaveBeenCalledWith(null);
      expect(platform.log.error).not.toHaveBeenCalled();
    });

    it('should handle errors from setApiState', async () => {
      const callback = vi.fn();
      const error = new Error('API Set Error');
      mockSetApiState.mockRejectedValue(error);
      await inst.handleSet(false, callback);
      expect(mockSetApiState).toHaveBeenCalledWith(false);
      expect(mockCacheManager.clear).not.toHaveBeenCalled(); // Should not clear cache on error
      expect(service.updateCharacteristic).not.toHaveBeenCalled(); // Should not update characteristic on error
      expect(callback).toHaveBeenCalledWith(error);
      // Update to match the actual log message format
      expect(platform.log.error).toHaveBeenCalledWith(
        expect.stringContaining('Error setting Test Switch to off for Test AC Display Name'),
        error
      );
    });
  });

  describe('updateCachedStatus', () => {
    it('should update cachedStatus from CacheManager', async () => {
      mockCacheManager.getStatus.mockResolvedValue({ opt_test: 'on', other_prop: 'value' });
      await inst.updateCachedStatus();
      expect(mockCacheManager.getStatus).toHaveBeenCalled();
      expect((inst as any).cachedStatus).toEqual({ opt_test: 'on', other_prop: 'value' });
    });

    it('should handle errors during status update', async () => {
      const error = new Error('Failed to get status');
      mockCacheManager.getStatus.mockRejectedValue(error);
      await inst.updateCachedStatus();
      expect(platform.log.error).toHaveBeenCalledWith(
        expect.stringContaining('Error updating Test Switch status for Test AC Display Name'),
        error
      );
      expect((inst as any).cachedStatus).toBeNull();
    });
  });
});
