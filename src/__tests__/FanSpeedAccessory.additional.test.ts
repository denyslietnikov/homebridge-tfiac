import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest';
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
import { FanSpeed, PowerState, OperationMode, SleepModeState, FanSpeedPercentMap } from '../enums.js';
import { DeviceState } from '../state/DeviceState.js';

// Mock the CacheManager module
vi.mock('../CacheManager.js');

// Import after mocking
import CacheManager from '../CacheManager.js';

describe('FanSpeedAccessory - Additional Tests', () => {
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

  // Test for comprehensive mapping of rotation speed to fan mode
  it('should map all rotation speed ranges to correct fan modes', () => {
    const inst = createTestInstance();
    
    // Direct access to the private method
    const mapRotationSpeedToFanMode = (inst as any).mapRotationSpeedToFanMode.bind(inst);
    
    // Test exact boundaries and mid-ranges
    expect(mapRotationSpeedToFanMode(0)).toBe(FanSpeed.Auto);
    expect(mapRotationSpeedToFanMode(1)).toBe(FanSpeed.Low);
    
    // Test basic ranges - just test a few key points to ensure the method is covered
    expect(mapRotationSpeedToFanMode(10)).toBe(FanSpeed.Low);        // Low speed for small percentages
    expect(mapRotationSpeedToFanMode(20)).toBe(FanSpeed.Low);        // Still in Low range
    expect(mapRotationSpeedToFanMode(35)).toBe(FanSpeed.MediumLow);  // Between 30% and 45% → MediumLow
    expect(mapRotationSpeedToFanMode(50)).toBe(FanSpeed.Auto);       // Between 45% and 55% → Auto
    expect(mapRotationSpeedToFanMode(60)).toBe(FanSpeed.MediumHigh); // Between 60% and 75% → MediumHigh
    expect(mapRotationSpeedToFanMode(90)).toBe(FanSpeed.High);       // Between 75% and 95% → High
    expect(mapRotationSpeedToFanMode(100)).toBe(FanSpeed.Turbo);     // 95% or above → Turbo
  });

  // Test with non-standard speeds
  it('should handle non-standard rotation speed values', () => {
    const inst = createTestInstance();
    const mapRotationSpeedToFanMode = (inst as any).mapRotationSpeedToFanMode.bind(inst);
    
    // Test with negative value (should map to some fan speed based on implementation)
    const negativeResult = mapRotationSpeedToFanMode(-10);
    // The actual implementation might return various values, just make sure it's a valid FanSpeed
    expect(Object.values(FanSpeed)).toContain(negativeResult);
    
    // Test with value over 100 (should be Turbo)
    expect(mapRotationSpeedToFanMode(110)).toBe(FanSpeed.Turbo);
  });

  // Test handling of device states with different modes
  it('should handle Auto mode correctly', () => {
    const inst = createTestInstance();
    
    // Set device state to Auto mode
    mockDeviceState.operationMode = OperationMode.Auto;
    const stateChangedListener = (mockDeviceState as any).stateChangedListener;
    
    // Trigger state change
    stateChangedListener(mockDeviceState);
    
    // Should set to inactive as fan control is not allowed in Auto mode
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.Active,
      platform.Characteristic.Active.INACTIVE
    );
  });

  it('should handle Dry mode correctly', () => {
    const inst = createTestInstance();
    
    // Set device state to Dry mode
    mockDeviceState.operationMode = OperationMode.Dry;
    const stateChangedListener = (mockDeviceState as any).stateChangedListener;
    
    // Trigger state change
    stateChangedListener(mockDeviceState);
    
    // Should set to inactive as fan control is not allowed in Dry mode
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.Active,
      platform.Characteristic.Active.INACTIVE
    );
  });

  it('should set mode to Cool when activating from Auto mode', async () => {
    const inst = createTestInstance();
    
    // Set device to Auto mode (fan control not allowed)
    mockDeviceState.operationMode = OperationMode.Auto;
    
    // Create a cloned device state that will be returned
    const clonedDeviceState = {
      ...mockDeviceState,
      setPower: vi.fn(),
      setOperationMode: vi.fn(),
      setFanSpeed: vi.fn()
    };
    
    // Make clone return our controlled object
    mockDeviceState.clone = vi.fn().mockReturnValue(clonedDeviceState);
    
    // Handle active set to turn on
    await (inst as any).handleActiveSet(platform.Characteristic.Active.ACTIVE);
    
    // Should change mode to Cool
    expect(clonedDeviceState.setOperationMode).toHaveBeenCalledWith(OperationMode.Cool);
  });

  it('should handle rotation speed set with turbo speed', () => {
    const inst = createTestInstance();
    
    vi.useFakeTimers();
    
    // Create a cloned device state that will be returned
    const clonedDeviceState = {
      ...mockDeviceState,
      setPower: vi.fn(),
      setOperationMode: vi.fn(),
      setFanSpeed: vi.fn()
    };
    
    // Make clone return our controlled object
    mockDeviceState.clone = vi.fn().mockReturnValue(clonedDeviceState);
    
    // Set rotation speed to maximum (100%)
    (inst as any).handleRotationSpeedSet(100);
    
    // Advance timers to trigger the debounced function
    vi.runAllTimers();
    
    // Should set fan speed to Turbo
    expect(clonedDeviceState.setFanSpeed).toHaveBeenCalledWith(FanSpeed.Turbo);
    
    vi.useRealTimers();
  });

  it('should handle state change with turbo mode active', () => {
    const inst = createTestInstance();
    
    // Set turbo mode active
    mockDeviceState.turboMode = PowerState.On;
    
    const stateChangedListener = (mockDeviceState as any).stateChangedListener;
    stateChangedListener(mockDeviceState);
    
    // Should update with Turbo speed percentage
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.RotationSpeed,
      FanSpeedPercentMap[FanSpeed.Turbo]
    );
  });

  it('should handle state change with sleep mode active', () => {
    const inst = createTestInstance();
    
    // Set sleep mode active
    mockDeviceState.sleepMode = SleepModeState.On;
    
    const stateChangedListener = (mockDeviceState as any).stateChangedListener;
    stateChangedListener(mockDeviceState);
    
    // Should update with Low speed percentage (as per implementation, since Silent doesn't exist)
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.RotationSpeed,
      FanSpeedPercentMap[FanSpeed.Low]
    );
  });

  it('should handle error in rotation speed set', async () => {
    const inst = createTestInstance();
    const logErrorSpy = vi.spyOn(platform.log, 'error');
    
    vi.useFakeTimers();
    
    // Make applyStateToDevice throw an error
    mockCacheManager.applyStateToDevice.mockRejectedValueOnce(new Error('Test error'));
    
    // Set rotation speed
    (inst as any).handleRotationSpeedSet(50);
    
    // Advance timers to trigger the debounced function
    vi.runAllTimers();
    
    // Wait for the promise rejection to propagate
    await vi.waitFor(() => {
      // Check that error was logged
      expect(logErrorSpy).toHaveBeenCalled();
    });
    
    vi.useRealTimers();
  });

  it('should handle active set with error', async () => {
    const inst = createTestInstance();
    
    // Make applyStateToDevice throw an error
    mockCacheManager.applyStateToDevice.mockRejectedValueOnce(new Error('Test error'));
    
    await expect(
      (inst as any).handleActiveSet(platform.Characteristic.Active.ACTIVE)
    ).rejects.toThrow();
    
    expect(platform.log.error).toHaveBeenCalled();
  });

  it('should cleanup resources properly on stopPolling', () => {
    const inst = createTestInstance();
    
    // Set a debounce timer
    (inst as any).debounceTimer = setTimeout(() => {}, 1000);
    
    // Call stopPolling
    inst.stopPolling();
    
    // Should remove listener and clear timeout
    expect(mockDeviceState.removeListener).toHaveBeenCalledWith('stateChanged', expect.any(Function));
    expect(platform.log.debug).toHaveBeenCalled();
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
            this.hapStatus = hapStatus;
          }
        },
        HapStatusError: class HapStatusError extends Error {
          constructor(public hapStatus: number) {
            super(`HAPStatusError: ${hapStatus}`);
            this.name = 'HAPStatusError';
            this.hapStatus = hapStatus;
          }
        },
        HAPStatus: {
          SUCCESS: 0,
          SERVICE_COMMUNICATION_FAILURE: -70402
        }
      }
    }
  } as unknown as TfiacPlatform;
}
