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
    
    (inst as any).cachedStatus = { fan_mode: '50' } as any;
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
    
    (inst as any).cachedStatus = null;
    const result = await new Promise((resolve) => {
      (inst as any).handleGet((err: any, val: any) => {
        resolve({ err, val });
      });
    }) as { err: any, val: any };
    // Now expecting default value (50) instead of error
    expect(result.err).toBeNull();
    expect(result.val).toBe(50);
  });

  it('should handle set and update status', async () => {
    const inst = new FanSpeedAccessory(platform, accessory);
    // Manually inject our mock API into the instance
    (inst as any).deviceAPI = deviceAPI;
    
    const cb = vi.fn();
    await (inst as any).handleSet(75, cb);
    expect(deviceAPI.setFanSpeed).toHaveBeenCalledWith('75');
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('should handle set error', async () => {
    deviceAPI.setFanSpeed.mockRejectedValueOnce(new Error('fail'));
    const inst = new FanSpeedAccessory(platform, accessory);
    // Manually inject our mock API into the instance
    (inst as any).deviceAPI = deviceAPI;
    
    const cb = vi.fn();
    await (inst as any).handleSet(30, cb);
    expect(cb).toHaveBeenCalledWith(expect.any(Error));
  });

  it('should updateStatus and update characteristic with valid fan_mode', () => {
    const inst = new FanSpeedAccessory(platform, accessory);
    // simulate status event
    inst['updateStatus']({ fan_mode: '75', is_on: 'on' } as any);
    
    // First call updates Active characteristic
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.Active,
      platform.Characteristic.Active.ACTIVE
    );
    
    // Second call updates RotationSpeed characteristic
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.RotationSpeed,
      50 // Default to 50 when fan_mode doesn't match any FanSpeed enum value
    );
  });

  it('should updateStatus and update characteristic with missing fan_mode', () => {
    const inst = new FanSpeedAccessory(platform, accessory);
    inst['updateStatus']({} as any);

    // First call updates Active characteristic
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.Active,
      platform.Characteristic.Active.INACTIVE // INACTIVE because is_on is undefined/null
    );
    
    // Second call updates RotationSpeed characteristic
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.RotationSpeed,
      50 // Default to 50 when fan_mode is missing
    );
  });

  it('should updateStatus and update characteristic with non-numeric fan_mode', () => {
    const inst = new FanSpeedAccessory(platform, accessory);
    inst['updateStatus']({ fan_mode: 'notanumber', is_on: 'off' } as any);
    
    // First call updates Active characteristic
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.Active,
      platform.Characteristic.Active.INACTIVE
    );
    
    // Second call updates RotationSpeed characteristic with default value
    // Since 'notanumber' is not a valid FanSpeed enum value, it uses the default (50)
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.RotationSpeed,
      50
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
});