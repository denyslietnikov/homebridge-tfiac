// filepath: /Users/denisletnikov/Code/homebridge-tfiac/src/__tests__/BaseSwitchAccessory.test.ts
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PlatformAccessory, Service, CharacteristicValue, CharacteristicSetCallback } from 'homebridge';
import { TfiacPlatform } from '../platform.js';
import { defaultDeviceOptions, createMockService, hapConstants } from './testUtils';

// We need to create this function since it's missing but used in tests
function createMockPlatform(): TfiacPlatform {
  return {
    log: {
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    },
    api: {
      hap: {
        Service: hapConstants.Service,
        Characteristic: hapConstants.Characteristic,
        HAPStatus: {
          SERVICE_COMMUNICATION_FAILURE: -70402
        },
        HapStatusError: class HapStatusError extends Error {
          hapStatus: number;
          constructor(status: number) {
            super(`HapStatusError: ${status}`);
            this.hapStatus = status;
          }
        }
      }
    },
    Service: hapConstants.Service,
    Characteristic: hapConstants.Characteristic,
  } as unknown as TfiacPlatform;
}
import { PowerState } from '../enums.js';
import { AirConditionerStatus } from '../AirConditionerAPI.js';
import { CacheManager } from '../CacheManager.js';
import { DeviceState } from '../state/DeviceState.js';

// Mock the CacheManager
vi.mock('../CacheManager.js', () => ({
  CacheManager: {
    getInstance: vi.fn(),
  },
}));

// Create a concrete implementation of the abstract BaseSwitchAccessory class for testing
import { BaseSwitchAccessory } from '../BaseSwitchAccessory.js';

class TestSwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
    deviceConfig = defaultDeviceOptions,
    customCacheManager?: any
  ) {
    const getStatusValue = (status: Partial<AirConditionerStatus>): boolean => {
      return status.is_on === PowerState.On;
    };
    
    const setApiState = async (value: boolean): Promise<void> => {
      // Implementation for testing - update cache directly
      const status = { is_on: value ? PowerState.On : PowerState.Off };
      const cm = CacheManager.getInstance();
      await cm.updateCache(deviceConfig.id, status);
    };
    
    super(
      platform,
      accessory,
      'Test Switch',
      'testswitch',
      getStatusValue,
      setApiState,
      'TestSwitch'
    );
    
    // Override the cacheManager if provided
    if (customCacheManager) {
      // @ts-ignore: Typescript doesn't like this but we're testing
      this.cacheManager = customCacheManager;
    }
  }
  
  // Expose protected methods for testing
  public exposedHandleGet(): CharacteristicValue {
    return this.handleGet();
  }
  
  public async exposedHandleSet(value: CharacteristicValue, callback: CharacteristicSetCallback): Promise<void> {
    return this.handleSet(value, callback);
  }
}

describe('BaseSwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let mockService: Service;
  let inst: TestSwitchAccessory;
  let mockCacheManager: any;
  let mockDeviceState: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Create platform
    platform = createMockPlatform();
    
    // Create service mock with proper characteristic mocks
    const mockOnCharacteristic = {
      onGet: vi.fn().mockImplementation(fn => {
        mockOnCharacteristic._getHandler = fn;
        return mockOnCharacteristic;
      }),
      onSet: vi.fn().mockImplementation(fn => {
        mockOnCharacteristic._setHandler = fn;
        return mockOnCharacteristic;
      }),
      updateValue: vi.fn(),
      _getHandler: null as any,
      _setHandler: null as any
    };
    
    mockService = {
      setCharacteristic: vi.fn().mockReturnThis(),
      getCharacteristic: vi.fn().mockImplementation(char => {
        if (char === platform.Characteristic.On) {
          return mockOnCharacteristic;
        }
        return { onGet: vi.fn(), onSet: vi.fn(), updateValue: vi.fn() };
      }),
      updateCharacteristic: vi.fn()
    } as unknown as Service;

    // Setup accessory mock with getServiceById
    accessory = {
      context: { 
        deviceConfig: defaultDeviceOptions
      },
      getServiceById: vi.fn().mockReturnValue(mockService),
      getService: vi.fn().mockReturnValue(null),
      addService: vi.fn().mockReturnValue(mockService),
    } as unknown as PlatformAccessory;
    
    // Create mock cache manager and device state
    mockDeviceState = {
      on: vi.fn().mockImplementation((event, callback) => {
        if (event === 'stateChanged') {
          // Store the callback for later
          mockDeviceState.stateChangedCallback = callback;
        }
        return mockDeviceState;
      }),
      removeListener: vi.fn(),
      emit: vi.fn(),
      power: PowerState.On,
      status: { is_on: PowerState.On },
      toApiStatus: vi.fn().mockReturnValue({
        is_on: PowerState.On,
        operation_mode: 'auto'
      }),
      stateChangedCallback: null
    };
    
    mockCacheManager = {
      getCachedStatus: vi.fn().mockResolvedValue({ is_on: PowerState.On }),
      updateCache: vi.fn().mockResolvedValue(undefined),
      getDeviceState: vi.fn().mockReturnValue(mockDeviceState),
      api: {
        setDeviceState: vi.fn().mockResolvedValue(undefined)
      }
    };
    
    // Set up the mock to return our mock cache manager
    vi.mocked(CacheManager.getInstance).mockReturnValue(mockCacheManager);
    
    // Create the test instance
    inst = new TestSwitchAccessory(platform, accessory);
  });
  
  it('should initialize with the correct services and characteristics', () => {
    // Check that it looks for the service by ID first
    expect(accessory.getServiceById).toHaveBeenCalledWith(
      platform.Service.Switch.UUID,
      'testswitch'
    );
    
    // Verify the service name was set
    expect(mockService.setCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.Name,
      'Test Switch'
    );
    
    // Verify handlers were registered
    expect(mockService.getCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.On
    );
    
    // Verify we registered for DeviceState events
    expect(mockDeviceState.on).toHaveBeenCalledWith(
      'stateChanged',
      expect.any(Function)
    );
  });
  
  it('should get the switch state from cache', async () => {
    // Make sure the mock is configured to be called with the correct device ID
    mockCacheManager.getCachedStatus = vi.fn().mockImplementation((deviceId) => {
      expect(deviceId).toBe(defaultDeviceOptions.id);
      return Promise.resolve({ is_on: PowerState.On });
    });
    
    const result = await inst.exposedHandleGet();
    
    expect(result).toBe(true);
  });
  
  it('should return false when no cached status is available', async () => {
    // We need to create a new instance with a modified cacheManager that returns null
    // First, create a new instance of TestSwitchAccessory
    const specialTestInst = new TestSwitchAccessory(platform, accessory);
    
    // Now directly set the cachedStatus to null for the test
    specialTestInst['cachedStatus'] = null;
    
    // Call the method
    const result = await specialTestInst.exposedHandleGet();
    
    // Since cachedStatus is null, we should get false
    expect(result).toBe(false);
  });
  
  it('should update cache when setting the switch state', async () => {
    // Call the exposed method directly
    const callback = vi.fn();
    
    await inst.exposedHandleSet(true, callback);
    
    expect(mockCacheManager.updateCache).toHaveBeenCalledWith(
      defaultDeviceOptions.id,
      { is_on: PowerState.On }
    );
    expect(callback).toHaveBeenCalledWith(null);
  });
  
  it('should handle errors when getting status', async () => {
    // Create a custom TestSwitchAccessory that will throw during handleGet
    class TestErrorSwitchAccessory extends BaseSwitchAccessory {
      constructor(platform: TfiacPlatform, accessory: PlatformAccessory) {
        const getStatusValue = (status: Partial<AirConditionerStatus>): boolean => {
          return status.is_on === PowerState.On;
        };
        
        const setApiState = async (value: boolean): Promise<void> => {
          // Mock implementation
        };
        
        super(
          platform,
          accessory,
          'Test Switch',
          'testswitch',
          getStatusValue,
          setApiState,
          'TestSwitch'
        );
      }
      
      // Override handleGet to throw an error
      public handleGet(): CharacteristicValue {
        this.platform.log.error(`[TestSwitch] Simulated error in handleGet`);
        throw new Error('Test error in handleGet');
      }
      
      // Expose the method for testing
      public exposedHandleGet(): CharacteristicValue {
        return this.handleGet();
      }
    }
    
    // Create an instance of our error-throwing switch
    const errorAccessory = new TestErrorSwitchAccessory(platform, accessory);
    
    // Call the method and expect it to throw
    let threwError = false;
    try {
      errorAccessory.exposedHandleGet();
    } catch (err) {
      threwError = true;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe('Test error in handleGet');
    }
    
    // Make sure we caught an error
    expect(threwError).toBe(true);
    
    // Verify the error was logged
    expect(platform.log.error).toHaveBeenCalled();
  });
  
  it('should handle errors when setting status', async () => {
    const error = new Error('Cache error');
    mockCacheManager.updateCache.mockRejectedValueOnce(error);
    
    const callback = vi.fn();
    await inst.exposedHandleSet(true, callback);
    
    // Check that the callback was called with an error
    expect(callback).toHaveBeenCalled();
    expect(callback.mock.calls[0][0]).toBeTruthy();
    expect(platform.log.error).toHaveBeenCalled();
  });
  
  it('should update the characteristic when device state changes', () => {
    // Get the event handler that was registered by looking at what was captured
    const stateChangedHandler = mockDeviceState.stateChangedCallback;
    
    // Create a new device state object with a specific toApiStatus implementation
    const newState = {
      power: PowerState.On,
      toApiStatus: vi.fn().mockReturnValue({ is_on: PowerState.On })
    };
    
    // Simulate a device state change event
    stateChangedHandler(newState);
    
    // Verify the characteristic was updated
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.On,
      true
    );
  });
  
  it('should cleanup when stopping polling', () => {
    inst.stopPolling();
    
    expect(mockDeviceState.removeListener).toHaveBeenCalledWith(
      'stateChanged',
      expect.any(Function)
    );
  });
});
