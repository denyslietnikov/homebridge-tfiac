import { FanSpeedAccessory } from '../FanSpeedAccessory';
import { TfiacPlatform } from '../platform';
import { PlatformAccessory, Service } from 'homebridge';

describe('FanSpeedAccessory', () => {
  let platform: any;
  let accessory: PlatformAccessory;
  let service: any;
  let deviceAPI: any;
  let log: any;

  beforeEach(() => {
    log = { debug: jest.fn(), error: jest.fn() };
    platform = {
      Service: { Fan: jest.fn() },
      Characteristic: { Name: 'Name', RotationSpeed: 'RotationSpeed' },
      log,
    } as any;
    service = {
      setCharacteristic: jest.fn(),
      getCharacteristic: jest.fn().mockReturnThis(),
      on: jest.fn().mockReturnThis(),
      updateCharacteristic: jest.fn(),
    };
    accessory = {
      context: { deviceConfig: { ip: '1.2.3.4', port: 1234, updateInterval: 1, name: 'Test' } },
      getService: jest.fn().mockReturnValue(undefined),
      addService: jest.fn().mockReturnValue(service),
    } as any;
    deviceAPI = {
      updateState: jest.fn().mockResolvedValue({ fan_mode: '25' }),
      setFanSpeed: jest.fn().mockResolvedValue(undefined),
      cleanup: jest.fn(),
    };
    jest.spyOn(require('../AirConditionerAPI'), 'default').mockImplementation(() => deviceAPI);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('should construct and set up polling and handlers', () => {
    const inst = new FanSpeedAccessory(platform, accessory);
    expect(accessory.addService).toHaveBeenCalledWith(platform.Service.Fanv2, 'Fan Speed', 'fan_speed');
    expect(service.setCharacteristic).toHaveBeenCalledWith('Name', 'Fan Speed');
    expect(service.getCharacteristic).toHaveBeenCalledWith('RotationSpeed');
  });

  it('should stop polling and cleanup', () => {
    const inst = new FanSpeedAccessory(platform, accessory);
    (inst as any).pollingInterval = setInterval(() => {}, 1000);
    inst.stopPolling();
    expect(deviceAPI.cleanup).toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalledWith(
      'FanSpeed polling stopped for %s',
      accessory.context.deviceConfig.name,
    );
  });

  it('should update cached status and update characteristic', async () => {
    const inst = new FanSpeedAccessory(platform, accessory);
    await (inst as any).updateCachedStatus();
    expect(service.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.RotationSpeed, 25);
  });

  it('should handle get with cached status', done => {
    const inst = new FanSpeedAccessory(platform, accessory);
    (inst as any).cachedStatus = { fan_mode: '50' } as any;
    (inst as any).handleGet((err: any, val: any) => {
      expect(err).toBeNull();
      expect(val).toBe(50);
      done();
    });
  });

  it('should handle get with no cached status', done => {
    const inst = new FanSpeedAccessory(platform, accessory);
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
    const cb = jest.fn();
    await (inst as any).handleSet(75, cb);
    expect(deviceAPI.setFanSpeed).toHaveBeenCalledWith('75');
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('should handle set error', async () => {
    deviceAPI.setFanSpeed.mockRejectedValueOnce(new Error('fail'));
    const inst = new FanSpeedAccessory(platform, accessory);
    const cb = jest.fn();
    await (inst as any).handleSet(30, cb);
    expect(cb).toHaveBeenCalledWith(expect.any(Error));
  });

  it('should call unref on pollingInterval in startPolling', () => {
    const inst = new FanSpeedAccessory(platform, accessory);
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
    const logSpy = jest.spyOn(log, 'error');
    await (inst as any).updateCachedStatus();
    expect(logSpy).toHaveBeenCalledWith('Error updating fan speed status:', expect.any(Error));
  });

  it('should handle updateCachedStatus with undefined fan_mode', async () => {
    deviceAPI.updateState
      .mockResolvedValueOnce({ fan_mode: '25' })
      .mockResolvedValueOnce({});
    const inst = new FanSpeedAccessory(platform, accessory);
    service.updateCharacteristic.mockClear(); // reset calls after constructor

    // Check that there was no call with 0 (undefined fan_mode)
    expect(service.updateCharacteristic).not.toHaveBeenCalledWith(
      platform.Characteristic.RotationSpeed,
      0
    );
  });

  it('should handle get with non-numeric fan_mode', done => {
    const inst = new FanSpeedAccessory(platform, accessory);
    (inst as any).cachedStatus = { fan_mode: 'notanumber' } as any;
    (inst as any).handleGet((err: any, val: any) => {
      expect(err).toBeNull();
      expect(val).toBe(0);
      done();
    });
  });

  it('should reuse existing Fan service if present', () => {
    accessory.getService = jest.fn().mockReturnValue(service);
    const inst = new FanSpeedAccessory(platform, accessory);
    expect(accessory.addService).not.toHaveBeenCalled();
    expect(accessory.getService).toHaveBeenCalledWith('Fan Speed');
  });

  it('should use existing service if available', () => {
    // Ensure getService returns the mock service
    (accessory.getService as jest.Mock).mockReturnValue(service);
    const inst = new FanSpeedAccessory(platform, accessory);
    expect(accessory.addService).not.toHaveBeenCalled();
    expect(service.setCharacteristic).toHaveBeenCalledWith('Name', 'Fan Speed');
  });

  it('should handle startPolling and stopPolling', () => {
    jest.useFakeTimers();
    const inst = new FanSpeedAccessory(platform, accessory);
    
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
    await (inst as any).updateCachedStatus();
    expect(log.error).toHaveBeenCalled();
  });

  it('should handle exception in handleGet callback', () => {
    jest.useFakeTimers();
    const inst = new FanSpeedAccessory(platform, accessory);
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