import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TfiacPlatform } from '../platform.js';
import { PlatformAccessory, Service, CharacteristicValue, CharacteristicSetCallback } from 'homebridge';
import { AirConditionerStatus } from '../AirConditionerAPI.js';
import { PowerState } from '../enums.js';
import { BaseSwitchAccessory } from '../BaseSwitchAccessory.js';
import { defaultDeviceOptions, hapConstants } from './testUtils.js';
import { DeviceState } from '../state/DeviceState.js';

// Create a concrete implementation of the abstract BaseSwitchAccessory class
class TestAdditionalSwitchAccessory extends BaseSwitchAccessory {
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
      // Implementation for testing
      const status = { is_on: value ? PowerState.On : PowerState.Off };
      await customCacheManager?.updateCache(deviceConfig.id, status);
    };
    
    super(
      platform,
      accessory,
      'Additional Test Switch',
      'additionalTestSwitch',
      getStatusValue,
      setApiState,
      'AdditionalTestSwitch'
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

  // Expose private methods for testing specific coverage areas
  public exposedUpdateCachedStatus(): Promise<void> {
    return (this as any).updateCachedStatus();
  }
}

// Function to create a mock platform
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
    config: {
      uiHoldSeconds: 10, // Add default UI hold seconds for platform
    },
    Service: hapConstants.Service,
    Characteristic: hapConstants.Characteristic,
  } as unknown as TfiacPlatform;
}

describe('BaseSwitchAccessory - Additional Coverage', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let mockService: Service;
  let inst: TestAdditionalSwitchAccessory;
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

    // Setup accessory mock
    accessory = {
      context: { 
        deviceConfig: {...defaultDeviceOptions, uiHoldSeconds: 5 }
      },
      getServiceById: vi.fn().mockReturnValue(mockService),
      getService: vi.fn().mockReturnValue(null),
      addService: vi.fn().mockReturnValue(mockService),
    } as unknown as PlatformAccessory;
    
    // Create mock device state
    mockDeviceState = {
      on: vi.fn().mockImplementation((event, callback) => {
        if (event === 'stateChanged') {
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
    
    // Create mock cache manager
    mockCacheManager = {
      getCachedStatus: vi.fn().mockResolvedValue({ is_on: PowerState.On }),
      updateCache: vi.fn().mockResolvedValue(undefined),
      getDeviceState: vi.fn().mockReturnValue(mockDeviceState),
      api: {
        setDeviceState: vi.fn().mockResolvedValue(undefined)
      },
      updateDeviceState: vi.fn().mockResolvedValue(undefined)
    };
    
    // Put the mock CacheManager instance in the accessory context
    accessory.context.cacheManager = mockCacheManager;
    
    // Create the test instance
    inst = new TestAdditionalSwitchAccessory(platform, accessory, defaultDeviceOptions, mockCacheManager);
  });

  // Test for the branch when accessory.addService.length < 3
  it('should handle the case when addService has less than 3 arguments', () => {
    // Reset the accessory mock
    accessory = {
      context: { 
        deviceConfig: defaultDeviceOptions,
        cacheManager: mockCacheManager
      },
      getServiceById: vi.fn().mockReturnValue(null),
      getService: vi.fn().mockReturnValue(null),
      addService: vi.fn().mockImplementation((service, name) => {
        // This simulates the case where addService doesn't accept a subtype
        return mockService;
      }),
    } as unknown as PlatformAccessory;
    
    // Create new instance with modified accessory
    inst = new TestAdditionalSwitchAccessory(platform, accessory, defaultDeviceOptions, mockCacheManager);
    
    // Verify the service was added
    expect(accessory.addService).toHaveBeenCalled();
    expect(mockService.setCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.Name,
      'Additional Test Switch'
    );
  });

  // Test for the case when service is null after trying to add it
  it('should handle the case when service is null after adding', () => {
    // Reset the accessory mock
    accessory = {
      context: { 
        deviceConfig: defaultDeviceOptions,
        cacheManager: mockCacheManager
      },
      getServiceById: vi.fn().mockReturnValue(null),
      getService: vi.fn().mockReturnValue(null),
      addService: vi.fn().mockReturnValue(null), // Return null to simulate failure
    } as unknown as PlatformAccessory;
    
    // Expect constructor to throw error due to null service
    expect(() => new TestAdditionalSwitchAccessory(platform, accessory, defaultDeviceOptions, mockCacheManager)).toThrow(/^Service was added but is still null/);
  });

  // Test for the updateCachedStatus method when polling is already in progress
  it('should not update when polling is already in progress', async () => {
    // Set isPolling to true
    (inst as any).isPolling = true;
    
    await inst.exposedUpdateCachedStatus();
    
    // Verify debug log was called but not the update
    expect(platform.log.debug).toHaveBeenCalledWith(
      expect.stringContaining('Polling already in progress')
    );
    expect(mockCacheManager.updateDeviceState).not.toHaveBeenCalled();
  });

  // Test for the updateCachedStatus method when it encounters an error
  it('should handle errors during updateCachedStatus', async () => {
    // Make updateDeviceState throw an error
    mockCacheManager.updateDeviceState.mockRejectedValueOnce(new Error('Test error'));
    
    await inst.exposedUpdateCachedStatus();
    
    // Verify error was logged
    expect(platform.log.error).toHaveBeenCalledWith(
      expect.stringContaining('Error updating status')
    );
    // Verify isPolling was reset to false
    expect((inst as any).isPolling).toBe(false);
  });

  // Test for _updateCharacteristicFromState when service is undefined
  it('should handle undefined service in _updateCharacteristicFromState', () => {
    // Set service to undefined
    (inst as any).service = undefined;
    
    // Call the method directly
    (inst as any)._updateCharacteristicFromState({ is_on: PowerState.On });
    
    // Verify warning was logged
    expect(platform.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('_updateCharacteristicFromState called but service is not available')
    );
  });

  // Test to check origGetService patch functionality
  it('should patch accessory.getService correctly', () => {
    // Prepare mock functions
    const origGetService = vi.fn().mockReturnValue(null);
    const newAccessory = {
      context: { 
        deviceConfig: defaultDeviceOptions,
        cacheManager: mockCacheManager
      },
      getServiceById: vi.fn().mockReturnValue(mockService),
      getService: origGetService,
      addService: vi.fn().mockReturnValue(mockService),
    } as unknown as PlatformAccessory;

    // Create new instance to apply the patch
    new TestAdditionalSwitchAccessory(platform, newAccessory, defaultDeviceOptions, mockCacheManager);

    // Verify that the patched getService function is working
    (newAccessory as any).getService('some-service');
    expect(origGetService).toHaveBeenCalledWith('some-service');
  });

  // Test for HapStatusError handling in handleSet
  it('should handle HapStatusError correctly', async () => {
    // Create a HapStatusError
    const hapError = new platform.api.hap.HapStatusError(platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    
    // Make updateCache throw the HapStatusError
    mockCacheManager.updateCache.mockRejectedValueOnce(hapError);
    
    // Call handleSet
    const callback = vi.fn();
    await inst.exposedHandleSet(true, callback);
    
    // Verify error handling
    expect(platform.log.error).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      hapStatus: platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
    }));
  });
});
