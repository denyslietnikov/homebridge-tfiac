import { vi, it, expect, describe, beforeEach, afterEach } from 'vitest';
import { StandaloneFanAccessory } from '../StandaloneFanAccessory.js';
import { TfiacPlatform } from '../platform.js';
import { PlatformAccessory, Service } from 'homebridge';
import { 
  createMockPlatformAccessory, 
  createMockService, 
  createMockDeviceState, 
  createMockCacheManager, 
  defaultDeviceOptions 
} from './testUtils.js';
import { PowerState, FanSpeed, OperationMode } from '../enums.js';
import { DeviceState } from '../state/DeviceState.js';

// Mock the CacheManager module
vi.mock('../CacheManager.js');

// Import after mocking
import CacheManager from '../CacheManager.js';

describe('StandaloneFanAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let service: Service;
  let mockCacheManager: any;
  let mockDeviceState: any;

  // Function to create a platform with necessary mocks
  function createTestPlatform() {
    return {
      log: {
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      },
      Service: {
        Fan: function(name: string, subtype?: string) {
          return service;
        },
        UUID: 'fan-service-uuid'
      },
      Characteristic: {
        ConfiguredName: {
          UUID: 'configured-name-uuid'
        },
        On: {
          UUID: 'on-uuid'
        },
        RotationSpeed: {
          UUID: 'rotation-speed-uuid'
        }
      }
    } as unknown as TfiacPlatform;
  }

  function createAccessoryAndOverrideCacheManager() {
    accessory.context = {
      deviceConfig: defaultDeviceOptions,
    };
    
    // Mock accessory.getService to return nothing so addService is called
    accessory.getService = vi.fn((serviceName) => {
      if (serviceName === 'Standalone Fan') {
        return undefined;
      }
      return undefined;
    });
    
    // Mock service.getCharacteristic to return a mock with proper behavior
    const onCharMock = {
      onGet: vi.fn().mockReturnThis(),
      onSet: vi.fn().mockReturnThis(),
      on: vi.fn().mockReturnThis(),
      value: true,
    };
    
    // Ensure service.getCharacteristic returns the correct mocks
    service.getCharacteristic = vi.fn().mockImplementation((characteristic) => {
      if (characteristic === platform.Characteristic.On) {
        return { ...onCharMock, value: true };
      } else if (characteristic === platform.Characteristic.RotationSpeed) {
        return { ...onCharMock, value: 50 };
      }
      return onCharMock;
    });
    
    service.updateCharacteristic = vi.fn();
    accessory.addService = vi.fn().mockReturnValue(service);
    
    return new StandaloneFanAccessory(platform, accessory);
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    
    platform = createTestPlatform();
    service = createMockService();
    
    accessory = createMockPlatformAccessory('Test Fan', 'test-uuid', { 
      ip: '1.2.3.4', 
      port: 1234, 
      updateInterval: 1, 
      name: 'Test',
      id: 'test-device-id'
    }, service);
    
    // Setup a mock device state
    mockDeviceState = createMockDeviceState(defaultDeviceOptions);
    mockDeviceState.power = PowerState.On;
    mockDeviceState.fanSpeed = FanSpeed.Auto;
    mockDeviceState.on = vi.fn((event, listener) => {
      if (event === 'stateChanged') {
        // Store listener for tests
        (mockDeviceState as any).stateChangedListener = listener;
      }
      return mockDeviceState;
    });
    mockDeviceState.removeListener = vi.fn().mockReturnValue(mockDeviceState);
    mockDeviceState.toApiStatus = vi.fn().mockReturnValue({
      is_on: PowerState.On,
      fan_mode: FanSpeed.Auto
    });
    
    // Create and setup CacheManager
    mockCacheManager = createMockCacheManager();
    mockCacheManager.getDeviceState = vi.fn().mockReturnValue(mockDeviceState);
    mockCacheManager.api = {
      setPower: vi.fn().mockResolvedValue(undefined),
      setFanAndSleep: vi.fn().mockResolvedValue(undefined)
    };
    
    // Mock the CacheManager.getInstance function properly
    (CacheManager.getInstance as any) = vi.fn().mockReturnValue(mockCacheManager);
  });

  it('should construct and set up polling and handlers', () => {
    const inst = createAccessoryAndOverrideCacheManager();
    
    // Accessory methods were called correctly
    expect(service.getCharacteristic).toHaveBeenCalledTimes(2);
    expect(service.updateCharacteristic).toHaveBeenCalled();
  });

  it('should use existing service if available', () => {
    const existingService = createMockService();
    existingService.getCharacteristic = vi.fn().mockImplementation((characteristic) => {
      if (characteristic === platform.Characteristic.On) {
        return { 
          onGet: vi.fn().mockReturnThis(),
          onSet: vi.fn().mockReturnThis(),
          on: vi.fn().mockReturnThis(),
          value: true
        };
      } else if (characteristic === platform.Characteristic.RotationSpeed) {
        return { 
          onGet: vi.fn().mockReturnThis(),
          onSet: vi.fn().mockReturnThis(),
          on: vi.fn().mockReturnThis(),
          value: 50
        };
      }
      return {
        onGet: vi.fn().mockReturnThis(),
        onSet: vi.fn().mockReturnThis(),
        on: vi.fn().mockReturnThis()
      };
    });
    existingService.updateCharacteristic = vi.fn();
    
    // Mock getService to return existing service for the service name
    accessory.getService = vi.fn().mockImplementation((nameOrService) => {
      if (nameOrService === 'Standalone Fan') {
        return existingService;
      }
      return undefined;
    });
    
    // Also need to mock getServiceById to return the service for the other checks
    accessory.getServiceById = vi.fn().mockImplementation((service, subtype) => {
      if ((service === platform.Service.Fan || service === platform.Service.Fan.UUID) && 
          subtype === 'standalone_fan') {
        return existingService;
      }
      return undefined;
    });
    
    // Make sure the context is set properly
    accessory.context = {
      deviceConfig: defaultDeviceOptions,
    };
    
    // Avoid using the common test helper which would override our mocks
    const inst = new StandaloneFanAccessory(platform, accessory);
    
    // Should not attempt to add a service if it already exists
    expect(accessory.addService).not.toHaveBeenCalled();
  });

  it('should do nothing on stopPolling', () => {
    const inst = createAccessoryAndOverrideCacheManager();
    
    inst.stopPolling();
    
    expect(mockDeviceState.removeListener).toHaveBeenCalled();
  });

  it('should updateStatus and update both characteristics', () => {
    const inst = createAccessoryAndOverrideCacheManager();
    
    // Get the listener from our mock
    const stateChangedListener = (mockDeviceState as any).stateChangedListener;
    expect(stateChangedListener).toBeDefined();
    
    // Call the listener with updated state
    stateChangedListener(mockDeviceState);
    
    // Both characteristics should be updated
    expect(service.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, true);
    expect(service.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.RotationSpeed, expect.any(Number));
  });

  it('should updateStatus with different fan modes', () => {
    const inst = createAccessoryAndOverrideCacheManager();
    
    mockDeviceState.toApiStatus = vi.fn().mockReturnValue({
      is_on: PowerState.On,
      fan_mode: FanSpeed.Low
    });
    
    // Get and call the listener
    const stateChangedListener = (mockDeviceState as any).stateChangedListener;
    stateChangedListener(mockDeviceState);
    
    // Should update with correct fan speed value
    expect(service.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.RotationSpeed, 25);
  });

  it('should handle get for On characteristic', () => {
    const inst = createAccessoryAndOverrideCacheManager();
    const callback = vi.fn();
    
    // Mock the service.getCharacteristic to return a value
    service.getCharacteristic = vi.fn().mockImplementation(() => {
      return { value: true };
    });
    
    // Call the handleGet method
    (inst as any).handleGet(callback);
    
    // Callback should be called with true
    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it('should handle set for On characteristic to turn on', async () => {
    const inst = createAccessoryAndOverrideCacheManager();
    const callback = vi.fn();
    
    // Call the handleSet method with true
    await (inst as any).handleSet(true, callback);
    
    // Should call setPower with PowerState.On and call the callback
    expect(mockCacheManager.api.setPower).toHaveBeenCalledWith(PowerState.On);
    expect(callback).toHaveBeenCalledWith(null);
  });

  it('should handle set for On characteristic to turn off', async () => {
    const inst = createAccessoryAndOverrideCacheManager();
    const callback = vi.fn();
    
    // Call the handleSet method with false
    await (inst as any).handleSet(false, callback);
    
    // Should call setPower with PowerState.Off and call the callback
    expect(mockCacheManager.api.setPower).toHaveBeenCalledWith(PowerState.Off);
    expect(callback).toHaveBeenCalledWith(null);
  });

  it('should handle set error for On characteristic', async () => {
    const inst = createAccessoryAndOverrideCacheManager();
    const callback = vi.fn();
    const error = new Error('Test error');
    
    // Make the API call fail
    mockCacheManager.api.setPower.mockRejectedValueOnce(error);
    
    // Call the handleSet method with true
    await (inst as any).handleSet(true, callback);
    
    // Should pass the error to the callback
    expect(callback).toHaveBeenCalledWith(error);
  });
  
  it('should handle get for RotationSpeed', () => {
    const inst = createAccessoryAndOverrideCacheManager();
    const callback = vi.fn();
    
    // Mock the service.getCharacteristic to return a value
    service.getCharacteristic = vi.fn().mockImplementation(() => {
      return { value: 50 };
    });
    
    // Call the handleRotationSpeedGet method
    (inst as any).handleRotationSpeedGet(callback);
    
    // Callback should be called with 50
    expect(callback).toHaveBeenCalledWith(null, 50);
  });

  it('should handle set for RotationSpeed', async () => {
    const inst = createAccessoryAndOverrideCacheManager();
    const callback = vi.fn();
    
    // Call the handleRotationSpeedSet method with 75 (High)
    await (inst as any).handleRotationSpeedSet(75, callback);
    
    // Should call setFanAndSleep with FanSpeed.High and current sleep mode
    expect(mockCacheManager.api.setFanAndSleep).toHaveBeenCalledWith(
      FanSpeed.High,
      mockDeviceState.sleepMode
    );
    expect(callback).toHaveBeenCalledWith(null);
  });

  it('should map fan modes to rotation speeds correctly', () => {
    const inst = createAccessoryAndOverrideCacheManager();
    
    // Test the private mapFanModeToRotationSpeed method
    expect((inst as any).mapFanModeToRotationSpeed(FanSpeed.Auto)).toBe(50);
    expect((inst as any).mapFanModeToRotationSpeed(FanSpeed.Low)).toBe(25);
    expect((inst as any).mapFanModeToRotationSpeed(FanSpeed.Medium)).toBe(50);
    expect((inst as any).mapFanModeToRotationSpeed(FanSpeed.High)).toBe(75);
  });
  
  it('should map rotation speeds to fan modes correctly', () => {
    const inst = createAccessoryAndOverrideCacheManager();
    
    // Test the private mapRotationSpeedToFanMode method
    expect((inst as any).mapRotationSpeedToFanMode(0)).toBe(FanSpeed.Auto);
    expect((inst as any).mapRotationSpeedToFanMode(25)).toBe(FanSpeed.Low);
    expect((inst as any).mapRotationSpeedToFanMode(50)).toBe(FanSpeed.Medium);
    expect((inst as any).mapRotationSpeedToFanMode(75)).toBe(FanSpeed.High);
    expect((inst as any).mapRotationSpeedToFanMode(100)).toBe(FanSpeed.Auto);
  });
});
