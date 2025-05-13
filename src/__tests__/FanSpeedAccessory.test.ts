// src/__tests__/FanSpeedAccessory.test.ts
import { vi, describe, beforeEach, afterEach, it, expect  } from 'vitest';
import { FanSpeedAccessory } from '../FanSpeedAccessory.js';
import { TfiacPlatform } from '../platform.js';
import { PlatformAccessory, Service } from 'homebridge';
import {
  createMockLogger,
  createMockService,
  createMockPlatformAccessory,
  createMockAPI,
  createMockDeviceState,
  createMockCacheManager,
  defaultDeviceOptions
} from './testUtils.js';
import { FanSpeed, PowerState, OperationMode, SleepModeState } from '../enums.js';
import { DeviceState } from '../state/DeviceState.js';

// Mock the CacheManager module
vi.mock('../CacheManager.js');

// Import after mocking
import CacheManager from '../CacheManager.js';

describe('FanSpeedAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let service: any;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockAPI: ReturnType<typeof createMockAPI>;
  let mockDeviceState: any;
  let mockCacheManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockLogger = createMockLogger();
    mockAPI = createMockAPI();
    
    // Add Active status to Characteristic mocks
    mockAPI.hap.Characteristic.Active = {
      ...mockAPI.hap.Characteristic.On,
      ACTIVE: 1,
      INACTIVE: 0,
    };
    
    // Add RotationSpeed characteristic
    mockAPI.hap.Characteristic.RotationSpeed = {
      ...mockAPI.hap.Characteristic.On,
      UUID: 'rotation-speed-uuid',
    };
    
    // Set up platform
    platform = setupTestPlatform();
    platform.Characteristic = mockAPI.hap.Characteristic as any;
    
    service = createMockService();
    
    accessory = createMockPlatformAccessory(
      'Test Device',
      'test-uuid',
      { ip: '1.2.3.4', port: 1234, updateInterval: 1, name: 'Test', id: 'test-id' },
      service
    );
    
    // Create device state with mock
    mockDeviceState = createMockDeviceState(defaultDeviceOptions);
    mockDeviceState.power = PowerState.On;
    mockDeviceState.operationMode = OperationMode.Cool;
    mockDeviceState.fanSpeed = FanSpeed.Auto;
    mockDeviceState.on = vi.fn((event, listener) => {
      if (event === 'stateChanged') {
        // Store the listener for testing
        (mockDeviceState as any).stateChangedListener = listener;
      }
      return mockDeviceState;
    });
    mockDeviceState.removeListener = vi.fn().mockReturnValue(mockDeviceState);
    mockDeviceState.clone = vi.fn().mockReturnValue({...mockDeviceState});
    mockDeviceState.setPower = vi.fn();
    mockDeviceState.setOperationMode = vi.fn();
    mockDeviceState.setFanSpeed = vi.fn();
    
    // Create CacheManager mock
    mockCacheManager = createMockCacheManager();
    mockCacheManager.getDeviceState = vi.fn().mockReturnValue(mockDeviceState);
    mockCacheManager.getStatus = vi.fn().mockResolvedValue({ 
      is_on: PowerState.On, 
      fan_mode: FanSpeed.Auto, 
      base_mode: OperationMode.Cool
    });
    mockCacheManager.applyStateToDevice = vi.fn().mockResolvedValue(undefined);
    // Use any to bypass readonly limitation
    (mockCacheManager as any).api = {
      setDeviceOptions: vi.fn().mockResolvedValue(undefined),
    };
    
    // Set up the mock getInstance function
    (CacheManager.getInstance as any) = vi.fn().mockReturnValue(mockCacheManager);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper function to create an instance with our mocks
  function createTestInstance(): FanSpeedAccessory {
    accessory.context = {
      deviceConfig: defaultDeviceOptions,
    };
    
    // Mock service implementation
    service.setCharacteristic = vi.fn().mockReturnValue(service);
    
    // Create a patched FanSpeedAccessory to avoid initialization errors
    const originalServiceGetter = accessory.getServiceById;
    accessory.getServiceById = vi.fn().mockReturnValue(undefined); // Force accessory.addService to be called
    accessory.addService = vi.fn().mockReturnValue(service);
    
    // Set up mock DeviceState properly
    mockDeviceState.setPower = vi.fn();
    mockDeviceState.setOperationMode = vi.fn();
    mockDeviceState.setFanSpeed = vi.fn();
    
    // Create a proper clone method
    mockDeviceState.clone = vi.fn().mockImplementation(() => {
      const cloned = {...mockDeviceState};
      cloned.setPower = vi.fn();
      cloned.setOperationMode = vi.fn();
      cloned.setFanSpeed = vi.fn();
      return cloned;
    });
    
    // Create the instance
    const instance = new FanSpeedAccessory(platform, accessory);
    
    // Restore getter to original behavior for other tests
    accessory.getServiceById = originalServiceGetter;
    
    return instance;
  }

  it('should construct and set up polling and handlers', () => {
    const inst = createTestInstance();
    
    expect(accessory.addService).toHaveBeenCalled();
    expect(service.setCharacteristic).toHaveBeenCalled();
  });

  it('should stop polling', () => {
    const inst = createTestInstance();
    
    // stopPolling should not throw or error
    expect(() => inst.stopPolling()).not.toThrow();
    expect(mockDeviceState.removeListener).toHaveBeenCalled();
  });

  it('should handle active get with cached status', () => {
    const inst = createTestInstance();
    
    // Simulate the handleGet method call with active fan control
    const result = (inst as any).handleActiveGet();
    
    // The result should be ACTIVE since our mock device state has power on and cool mode
    expect(result).toBe(platform.Characteristic.Active.ACTIVE);
  });

  it('should handle rotation speed get', () => {
    const inst = createTestInstance();
    
    // Simulate the handleRotationSpeedGet method call
    const result = (inst as any).handleRotationSpeedGet();
    
    // Result should be a number (fan speed percentage)
    expect(typeof result).toBe('number');
  });

  it('should handle state change events', () => {
    const inst = createTestInstance();
    
    // Get the listener from our mock
    const stateChangedListener = (mockDeviceState as any).stateChangedListener;
    expect(stateChangedListener).toBeDefined();
    
    // Call the listener with updated state
    stateChangedListener(mockDeviceState);
    
    // Characteristic update should have been called
    expect(service.updateCharacteristic).toHaveBeenCalled();
  });

  it('should handle active set', async () => {
    const inst = createTestInstance();
    const callback = vi.fn();
    
    // Set active to ACTIVE
    await (inst as any).handleActiveSet(platform.Characteristic.Active.ACTIVE, callback);
    
    // Verify callback was called and state was updated
    expect(callback).toHaveBeenCalledWith(null);
    expect(mockCacheManager.applyStateToDevice).toHaveBeenCalled();
  });

  it('should handle rotation speed set', () => {
    const inst = createTestInstance();
    const callback = vi.fn();
    
    // Mock timer
    vi.useFakeTimers();
    
    // Set rotation speed
    (inst as any).handleRotationSpeedSet(50, callback);
    
    // Callback should be called immediately
    expect(callback).toHaveBeenCalledWith(null);
    
    // Fast-forward timer to trigger the debounced function
    vi.runAllTimers();
    
    // FanSpeed should have been set on a cloned object
    expect(mockCacheManager.applyStateToDevice).toHaveBeenCalled();
    
    // Restore timers
    vi.useRealTimers();
  });
});

// Helper function to create a platform
function setupTestPlatform(): TfiacPlatform {
  return {
    log: createMockLogger(),
    Service: {
      Fan: {
        UUID: 'fan-uuid'
      },
      Fanv2: {
        UUID: 'fanv2-uuid'
      }
    },
    Characteristic: {
      Active: {
        ACTIVE: 1,
        INACTIVE: 0,
        UUID: 'active-uuid'
      },
      RotationSpeed: {
        UUID: 'rotation-speed-uuid'
      },
      ConfiguredName: {
        UUID: 'configured-name-uuid'
      }
    },
    api: {
      hap: {
        HAPStatusError: class HAPStatusError extends Error {
          constructor(public hapStatus: number) {
            super(`HAPStatusError: ${hapStatus}`);
            this.name = 'HAPStatusError';
            this.status = hapStatus;
          }
          status: number;
        },
        HapStatusError: class HapStatusError extends Error {
          constructor(public hapStatus: number) {
            super(`HAPStatusError: ${hapStatus}`);
            this.name = 'HAPStatusError';
            this.status = hapStatus;
          }
          status: number;
        },
        HAPStatus: {
          SUCCESS: 0,
          SERVICE_COMMUNICATION_FAILURE: -70402
        }
      }
    }
  } as unknown as TfiacPlatform;
}
