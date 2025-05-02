import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';
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

// Use type assertion to fix the jest.Mock compatibility issue
import AirConditionerAPI from '../AirConditionerAPI.js';

// Mock AirConditionerAPI at the module level
jest.mock('../AirConditionerAPI.js', () => {
  return jest.fn();
}, { virtual: true });

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
    (AirConditionerAPI as unknown as jest.Mock).mockImplementation(() => deviceAPI);
    
    // Mock service methods for characteristic handling
    service.getCharacteristic.mockImplementation(() => {
      return {
        onGet: jest.fn().mockReturnThis(),
        onSet: jest.fn().mockReturnThis(),
        on: jest.fn().mockReturnThis(),
        updateValue: jest.fn().mockReturnThis(),
      };
    });
    
    // Fix type compatibility issues with proper type assertions
    const getServiceMock = jest.fn().mockReturnValue(undefined);
    const addServiceMock = jest.fn().mockReturnValue(service);
    
    // Type assertions to fix TypeScript errors
    accessory.getService = getServiceMock as unknown as PlatformAccessory['getService'];
    accessory.addService = addServiceMock as unknown as PlatformAccessory['addService'];
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
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

  it('should handle get with cached status', done => {
    const inst = new FanSpeedAccessory(platform, accessory);
    // Manually inject our mock API into the instance
    (inst as any).deviceAPI = deviceAPI;
    
    (inst as any).cachedStatus = { fan_mode: '50' } as any;
    (inst as any).handleGet((err: any, val: any) => {
      expect(err).toBeNull();
      expect(val).toBe(50);
      done();
    });
  });

  it('should handle get with no cached status', done => {
    const inst = new FanSpeedAccessory(platform, accessory);
    // Manually inject our mock API into the instance
    (inst as any).deviceAPI = deviceAPI;
    
    (inst as any).cachedStatus = null;
    (inst as any).handleGet((err: any, val: any) => {
      // Now expecting default value (50) instead of error
      expect(err).toBeNull();
      expect(val).toBe(50);
      done();
    });
  });

  it('should handle set and update status', async () => {
    const inst = new FanSpeedAccessory(platform, accessory);
    // Manually inject our mock API into the instance
    (inst as any).deviceAPI = deviceAPI;
    
    const cb = jest.fn();
    await (inst as any).handleSet(75, cb);
    expect(deviceAPI.setFanSpeed).toHaveBeenCalledWith('75');
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('should handle set error', async () => {
    deviceAPI.setFanSpeed.mockRejectedValueOnce(new Error('fail'));
    const inst = new FanSpeedAccessory(platform, accessory);
    // Manually inject our mock API into the instance
    (inst as any).deviceAPI = deviceAPI;
    
    const cb = jest.fn();
    await (inst as any).handleSet(30, cb);
    expect(cb).toHaveBeenCalledWith(expect.any(Error));
  });

  it('should updateStatus and update characteristic with valid fan_mode', () => {
    const inst = new FanSpeedAccessory(platform, accessory);
    // simulate status event
    inst['updateStatus']({ fan_mode: '75' } as any);
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.RotationSpeed,
      75,
    );
  });

  it('should updateStatus and update characteristic with missing fan_mode', () => {
    const inst = new FanSpeedAccessory(platform, accessory);
    inst['updateStatus']({} as any);
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.RotationSpeed,
      50,
    );
  });

  it('should updateStatus and update characteristic with non-numeric fan_mode', () => {
    const inst = new FanSpeedAccessory(platform, accessory);
    inst['updateStatus']({ fan_mode: 'notanumber' } as any);
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.RotationSpeed,
      0,
    );
  });

  it('should reuse existing Fan service if present', () => {
    const service = createMockService();
    // Use proper type assertions to fix TypeScript errors
    accessory.getServiceById = jest.fn().mockReturnValue(service) as unknown as PlatformAccessory['getServiceById'];
    accessory.addService = jest.fn() as unknown as PlatformAccessory['addService'];
    
    const inst = new FanSpeedAccessory(platform, accessory);
    (inst as any).deviceAPI = deviceAPI;
    
    expect(accessory.addService).not.toHaveBeenCalled();
    expect(accessory.getServiceById).toHaveBeenCalled();
  });
});