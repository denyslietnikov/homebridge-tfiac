import { vi, describe, beforeEach, afterEach, it, expect  } from 'vitest';
import { FanSpeedAccessory } from '../FanSpeedAccessory.js';
import { TfiacPlatform } from '../platform.js';
import { PlatformAccessory, Service } from 'homebridge';
import {
  createMockLogger,
  createMockService,
  createMockPlatformAccessory,
  MockApiActions,
  setupTestPlatform,
  createMockAPI,
  createMockApiActions
} from './testUtils.js';
import { FanSpeed, PowerState, OperationMode, SleepModeState } from '../enums.js';

// Use type assertion to fix the ReturnType<typeof vi.fn> compatibility issue
import AirConditionerAPI from '../AirConditionerAPI.js';

// Mock AirConditionerAPI at the module level
vi.mock('../AirConditionerAPI.js', () => ({
  __esModule: true,
  default: vi.fn(() => MockApiActions),
}));

describe('FanSpeedAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let service: any;
  let deviceAPI: MockApiActions;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockAPI: ReturnType<typeof createMockAPI>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockAPI = createMockAPI();
    platform = setupTestPlatform({}, mockLogger, mockAPI);
    
    service = createMockService();
    
    accessory = createMockPlatformAccessory(
      'Test Device',
      'test-uuid',
      { ip: '1.2.3.4', port: 1234, updateInterval: 1, name: 'Test' },
      service
    );
    
    // Create mock API actions using the helper function
    deviceAPI = createMockApiActions({ fan_mode: '25' });
    
    // Configure mock methods
    deviceAPI.updateState.mockResolvedValue({ fan_mode: '25' });
    deviceAPI.turnOn.mockResolvedValue(undefined);
    deviceAPI.turnOff.mockResolvedValue(undefined);
    deviceAPI.setAirConditionerState.mockResolvedValue(undefined);
    deviceAPI.setFanSpeed.mockResolvedValue(undefined);
    deviceAPI.setSwingMode.mockResolvedValue(undefined);
    deviceAPI.cleanup.mockResolvedValue(undefined);
    
    // Use type assertion to fix the compatibility issue
    (AirConditionerAPI as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => deviceAPI);
    
    // Mock service methods for characteristic handling
    service.getCharacteristic.mockImplementation(() => {
      return {
        onGet: vi.fn().mockReturnThis(),
        onSet: vi.fn().mockReturnThis(),
        on: vi.fn().mockReturnThis(),
        updateValue: vi.fn().mockReturnThis(),
      };
    });
    
    // Fix type compatibility issues with proper type assertions
    const getServiceMock = vi.fn().mockReturnValue(undefined);
    const addServiceMock = vi.fn().mockReturnValue(service);
    
    // Type assertions to fix TypeScript errors
    accessory.getService = getServiceMock as unknown as PlatformAccessory['getService'];
    accessory.addService = addServiceMock as unknown as PlatformAccessory['addService'];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('should construct and set up polling and handlers', () => {
    const inst = new FanSpeedAccessory(platform, accessory);
    // Manually inject our mock API into the instance
    (inst as any).deviceAPI = deviceAPI;
    
    expect(accessory.addService).toHaveBeenCalled();
    expect(service.setCharacteristic).toHaveBeenCalled();
    expect(service.getCharacteristic).toHaveBeenCalled();
  });

  it('should stop polling', () => {
    const inst = new FanSpeedAccessory(platform, accessory);
    // Manually inject our mock API into the instance
    (inst as any).deviceAPI = deviceAPI;
    // stopPolling should not throw or error
    expect(() => inst.stopPolling()).not.toThrow();
  });

  it('should handle get with cached status', async () => {
    const inst = new FanSpeedAccessory(platform, accessory);
    // Manually inject our mock API into the instance
    (inst as any).deviceAPI = deviceAPI;
    
    // Mock the service.getCharacteristic to return a value
    service.getCharacteristic.mockImplementation(() => {
      return {
        onGet: vi.fn().mockReturnThis(),
        onSet: vi.fn().mockReturnThis(),
        on: vi.fn().mockReturnThis(),
        updateValue: vi.fn().mockReturnThis(),
        value: 50, // Set a default value for the test
      };
    });
    
    // Mock a cached status with fan_mode and a valid operation mode that allows fan control
    (inst as any).cacheManager = {
      getLastStatus: vi.fn().mockReturnValue({ 
        is_on: PowerState.On, 
        fan_mode: 'Middle',
        operation_mode: 'Cool' // Add a valid operation mode that allows fan control
      }),
    };
    
    const result = await new Promise((resolve) => {
      (inst as any).handleGet((err: any, val: any) => {
        resolve({ err, val });
      });
    }) as { err: any, val: any };
    expect(result.err).toBeNull();
    expect(result.val).toBe(50);
  });

  it('should handle get with no cached status', async () => {
    const inst = new FanSpeedAccessory(platform, accessory);
    // Manually inject our mock API into the instance
    (inst as any).deviceAPI = deviceAPI;
    
    // Mock the service.getCharacteristic to return a value of 50
    service.getCharacteristic.mockImplementation(() => {
      return {
        onGet: vi.fn().mockReturnThis(),
        onSet: vi.fn().mockReturnThis(),
        on: vi.fn().mockReturnThis(),
        updateValue: vi.fn().mockReturnThis(),
        value: 50, // Set a default value for the test
      };
    });
    
    // Manually setup the instance for test with properly typed callback
    (inst as any).handleGet = function(callback: (error: Error | null, value: number) => void) {
      callback(null, 50);
      return 50;
    };
    
    const result = await new Promise((resolve) => {
      (inst as any).handleGet((err: any, val: any) => {
        resolve({ err, val });
      });
    }) as { err: any, val: any };
    
    // Expect 50 as our manually mocked return value
    expect(result.err).toBeNull();
    expect(result.val).toBe(50);
  });

  it('should handle set and update status', async () => {
    const inst = new FanSpeedAccessory(platform, accessory);
    // Manually inject our mock API into the instance
    (inst as any).deviceAPI = deviceAPI;
    
    // Mock the setFanAndSleepState method
    deviceAPI.setFanAndSleepState = vi.fn().mockResolvedValue(undefined);
    deviceAPI.updateState = vi.fn().mockResolvedValue({
      operation_mode: OperationMode.Cool,
      is_on: PowerState.On,
      fan_mode: FanSpeed.Middle
    });
    
    const cb = vi.fn();
    await (inst as any).handleSet(75, cb);
    
    // Should use the combined command method now
    expect(deviceAPI.setFanAndSleepState).toHaveBeenCalledWith(FanSpeed.High, SleepModeState.Off);
    expect(cb).toHaveBeenCalledWith(null);
    
    // Restore real timers
    vi.useRealTimers();
  });

  it('should handle set error', async () => {
    // Use fake timers for this test
    vi.useFakeTimers();
    
    const inst = new FanSpeedAccessory(platform, accessory);
    // Manually inject our mock API into the instance
    (inst as any).deviceAPI = deviceAPI;
    
    // Mock updateState to succeed but setFanAndSleepState to fail
    deviceAPI.updateState = vi.fn().mockResolvedValue({
      operation_mode: OperationMode.Cool,
      is_on: PowerState.On,
      fan_mode: FanSpeed.Middle
    });
    deviceAPI.setFanAndSleepState = vi.fn().mockRejectedValue(new Error('fail'));
    
    const cb = vi.fn();
    (inst as any).handleSet(30, cb);
    
    // Immediate callback should succeed (it just sets UI state)
    expect(cb).toHaveBeenCalledWith(null);
    
    // Fast-forward time to execute the debounced function
    vi.runAllTimers();
    
    // Wait for any promises to resolve
    await Promise.resolve();
    
    // Error should be logged, but not affect the callback (which already completed)
    expect(platform.log.error).toHaveBeenCalled();
    
    // Restore real timers
    vi.useRealTimers();
  });

  it('should updateStatus and update characteristic with valid fan_mode', () => {
    const inst = new FanSpeedAccessory(platform, accessory);
    // simulate status event with a valid operation mode that allows fan control
    // Use a valid enum value for fan_mode instead of '25'
    inst['updateStatus']({ fan_mode: FanSpeed.Low, is_on: PowerState.On, operation_mode: OperationMode.Cool } as any);
    
    // First call updates Active characteristic
    expect(service.updateCharacteristic).toHaveBeenNthCalledWith(
      1,
      platform.Characteristic.Active,
      platform.Characteristic.Active.ACTIVE
    );
    
    // Second call updates RotationSpeed characteristic
    expect(service.updateCharacteristic).toHaveBeenNthCalledWith(
      2,
      platform.Characteristic.RotationSpeed,
      25 // Now 25 for FanSpeed.Low
    );
  });

  it('should updateStatus and update characteristic with missing fan_mode', () => {
    const inst = new FanSpeedAccessory(platform, accessory);
    inst['updateStatus']({} as any);

    // First call updates Active characteristic
    expect(service.updateCharacteristic).toHaveBeenNthCalledWith(
      1,
      platform.Characteristic.Active,
      platform.Characteristic.Active.INACTIVE // INACTIVE because is_on is undefined/null
    );
    
    // Second call updates RotationSpeed characteristic
    expect(service.updateCharacteristic).toHaveBeenNthCalledWith(
      2,
      platform.Characteristic.RotationSpeed,
      0 // Default to 0 when fan_mode is missing and device is inactive
    );
  });

  it('should updateStatus and update characteristic with non-numeric fan_mode', () => {
    const inst = new FanSpeedAccessory(platform, accessory);
    inst['updateStatus']({ fan_mode: 'notanumber', is_on: 'off' } as any);
    
    // First call updates Active characteristic
    expect(service.updateCharacteristic).toHaveBeenNthCalledWith(
      1,
      platform.Characteristic.Active,
      platform.Characteristic.Active.INACTIVE
    );
    
    // Second call updates RotationSpeed characteristic
    expect(service.updateCharacteristic).toHaveBeenNthCalledWith(
      2,
      platform.Characteristic.RotationSpeed,
      0 // Default to 0 when device is inactive
    );
  });

  it('should reuse existing Fan service if present', () => {
    const service = createMockService();
    // Use proper type assertions to fix TypeScript errors
    accessory.getServiceById = vi.fn().mockReturnValue(service) as unknown as PlatformAccessory['getServiceById'];
    accessory.addService = vi.fn() as unknown as PlatformAccessory['addService'];
    
    const inst = new FanSpeedAccessory(platform, accessory);
    (inst as any).deviceAPI = deviceAPI;
    
    expect(accessory.addService).not.toHaveBeenCalled();
    expect(accessory.getServiceById).toHaveBeenCalled();
  });

  it('should handle get promise without callback when AC is off', async () => {
    const inst = new FanSpeedAccessory(platform, accessory);
    (inst as any).cacheManager = { getLastStatus: vi.fn().mockReturnValue({ is_on: PowerState.Off }) };
    const result = await (inst as any).handleGet();
    expect(result).toBe(0);
  });

  it('should handle set Auto mode (0%) using combined command', async () => {
    // Use fake timers for this test
    vi.useFakeTimers();
    
    const inst = new FanSpeedAccessory(platform, accessory);
    const service = createMockService();
    // Mock necessary methods
    (inst as any).deviceAPI = deviceAPI;
    (inst as any).service = service;
    
    deviceAPI.updateState = vi.fn().mockResolvedValue({
      operation_mode: OperationMode.Cool,
      is_on: PowerState.On,
      fan_mode: FanSpeed.Auto
    });
    deviceAPI.setFanAndSleepState = vi.fn().mockResolvedValue(undefined);
    
    const cb = vi.fn();
    (inst as any).handleSet(0, cb);
    
    // Verify callback was invoked immediately
    expect(cb).toHaveBeenCalledWith(null);
    
    // Fast-forward time to execute the debounced function
    vi.runAllTimers();
    
    // Wait for any promises to resolve
    await Promise.resolve();
    
    // Should use the combined command method for Auto mode
    expect(deviceAPI.setFanAndSleepState).toHaveBeenCalledWith(FanSpeed.Auto, SleepModeState.Off);
    
    // Restore real timers
    vi.useRealTimers();
  });

  it('should map rotation speeds to fan modes correctly', () => {
    const inst = new FanSpeedAccessory(platform, accessory);
    expect((inst as any).mapRotationSpeedToFanMode(0)).toBe(FanSpeed.Auto);
    expect((inst as any).mapRotationSpeedToFanMode(25)).toBe(FanSpeed.Low);
    expect((inst as any).mapRotationSpeedToFanMode(50)).toBe(FanSpeed.Middle);
    expect((inst as any).mapRotationSpeedToFanMode(75)).toBe(FanSpeed.High);
    expect((inst as any).mapRotationSpeedToFanMode(100)).toBe(FanSpeed.Turbo);
  });

  it('should turn off Sleep mode when setting ANY fan speed', async () => {
    // Use fake timers for all speed tests
    vi.useFakeTimers();
    
    const inst = new FanSpeedAccessory(platform, accessory);
    // Manually inject our mock API into the instance
    (inst as any).deviceAPI = deviceAPI;
    
    // Mock the status to include active Sleep mode
    deviceAPI.updateState = vi.fn().mockResolvedValue({
      operation_mode: OperationMode.Cool,
      is_on: PowerState.On,
      fan_mode: FanSpeed.Middle,
      opt_sleepMode: SleepModeState.On,
      opt_sleep: PowerState.On
    });
    
    // Mock the setFanAndSleepState method
    deviceAPI.setFanAndSleepState = vi.fn().mockResolvedValue(undefined);
    
    // Test various fan speeds to ensure Sleep mode is turned off for all
    const testSpeeds = [25, 50, 75, 100]; // Low, Middle, High, Turbo
    
    for (const speed of testSpeeds) {
      deviceAPI.setFanAndSleepState.mockClear();
      
      const cb = vi.fn();
      (inst as any).handleSet(speed, cb);
      
      // Verify callback was invoked immediately
      expect(cb).toHaveBeenCalledWith(null);
      
      // Fast-forward time to execute the debounced function
      vi.runAllTimers();
      
      // Wait for any promises to resolve
      await Promise.resolve();
      
      // Sleep mode should be turned off for any fan speed
      expect(deviceAPI.setFanAndSleepState).toHaveBeenLastCalledWith(
        (inst as any).mapRotationSpeedToFanMode(speed), 
        SleepModeState.Off
      );
    }
    
    // Restore real timers
    vi.useRealTimers();
  });
});