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

  it('should stop polling and cleanup', () => {
    const inst = new FanSpeedAccessory(platform, accessory);
    // Manually inject our mock API into the instance
    (inst as any).deviceAPI = deviceAPI;
    
    (inst as any).pollingInterval = setInterval(() => {}, 1000);
    inst.stopPolling();
    expect(deviceAPI.cleanup).toHaveBeenCalled();
    expect(mockLogger.debug).toHaveBeenCalledWith(
      'FanSpeed polling stopped for %s',
      accessory.context.deviceConfig.name,
    );
  });

  it('should update cached status and update characteristic', async () => {
    const inst = new FanSpeedAccessory(platform, accessory);
    // Manually inject our mock API into the instance
    (inst as any).deviceAPI = deviceAPI;
    
    await (inst as any).updateCachedStatus();
    expect(service.updateCharacteristic).toHaveBeenCalled();
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

  it('should call unref on pollingInterval in startPolling', () => {
    const inst = new FanSpeedAccessory(platform, accessory);
    // Manually inject our mock API into the instance
    (inst as any).deviceAPI = deviceAPI;
    
    const interval = { unref: jest.fn() };
    const origSetInterval = global.setInterval;
    jest.spyOn(global, 'setInterval').mockReturnValue(interval as any);
    (inst as any).startPolling();
    expect(interval.unref).toHaveBeenCalled();
    (global.setInterval as jest.Mock).mockRestore();
  });

  it('should handle updateCachedStatus error', async () => {
    deviceAPI.updateState.mockRejectedValueOnce(new Error('fail'));
    const inst = new FanSpeedAccessory(platform, accessory);
    // Manually inject our mock API into the instance
    (inst as any).deviceAPI = deviceAPI;
    
    await (inst as any).updateCachedStatus();
    expect(mockLogger.error).toHaveBeenCalledWith('Error updating fan speed status:', expect.any(Error));
  });

  it('should handle updateCachedStatus with undefined fan_mode', async () => {
    deviceAPI.updateState
      .mockResolvedValueOnce({ fan_mode: '25' })
      .mockResolvedValueOnce({});
    const inst = new FanSpeedAccessory(platform, accessory);
    // Manually inject our mock API into the instance
    (inst as any).deviceAPI = deviceAPI;
    
    service.updateCharacteristic.mockClear(); // reset calls after constructor

    await (inst as any).updateCachedStatus();
    // Ensure it doesn't throw an error with undefined fan_mode
    expect(deviceAPI.updateState).toHaveBeenCalled();
  });

  it('should handle get with non-numeric fan_mode', done => {
    const inst = new FanSpeedAccessory(platform, accessory);
    // Manually inject our mock API into the instance
    (inst as any).deviceAPI = deviceAPI;
    
    (inst as any).cachedStatus = { fan_mode: 'notanumber' } as any;
    (inst as any).handleGet((err: any, val: any) => {
      expect(err).toBeNull();
      expect(val).toBe(0);
      done();
    });
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

  it('should handle startPolling and stopPolling', () => {
    jest.useFakeTimers();
    const inst = new FanSpeedAccessory(platform, accessory);
    // Manually inject our mock API into the instance
    (inst as any).deviceAPI = deviceAPI;
    
    // Test that polling is started
    expect(deviceAPI.updateState).toHaveBeenCalled();
    const callCountAtStart = deviceAPI.updateState.mock.calls.length;
    
    // Advance timers to trigger polling
    jest.advanceTimersByTime(30000);
    expect(deviceAPI.updateState.mock.calls.length).toBeGreaterThan(callCountAtStart);
    
    // Test stopping the polling
    inst.stopPolling();
    const callsAfterStop = deviceAPI.updateState.mock.calls.length;
    jest.advanceTimersByTime(30000);
    expect(deviceAPI.updateState.mock.calls.length).toBe(callsAfterStop);
    
    jest.useRealTimers();
  });

  it('should handle error during update cached status', async () => {
    deviceAPI.updateState.mockRejectedValueOnce(new Error('Network error'));
    const inst = new FanSpeedAccessory(platform, accessory);
    // Manually inject our mock API into the instance
    (inst as any).deviceAPI = deviceAPI;
    
    await (inst as any).updateCachedStatus();
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('should handle exception in handleGet callback', () => {
    jest.useFakeTimers();
    const inst = new FanSpeedAccessory(platform, accessory);
    // Manually inject our mock API into the instance
    (inst as any).deviceAPI = deviceAPI;
    
    // Force an error by defining a getter that throws
    Object.defineProperty(inst as any, 'cachedStatus', { get: () => { throw new Error('Test error'); } });

    // Now call the GET handler
    (inst as any).handleGet((err: any, val: any) => {
      // Should return default value instead of error
      expect(err).toBeNull();
      expect(val).toBe(50);
    });
  });
});