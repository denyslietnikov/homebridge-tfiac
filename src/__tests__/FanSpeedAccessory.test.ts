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
    expect(accessory.addService).toHaveBeenCalledWith(platform.Service.Fan, 'Fan Speed');
    expect(service.setCharacteristic).toHaveBeenCalledWith('Name', 'Fan Speed');
    expect(service.getCharacteristic).toHaveBeenCalledWith('RotationSpeed');
    expect(service.on).toHaveBeenCalledTimes(2);
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
    expect(service.updateCharacteristic).toHaveBeenCalledWith('RotationSpeed', 25);
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
      expect(err).toBeInstanceOf(Error);
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
    service.updateCharacteristic.mockClear(); // сбросить вызовы после конструктора
    await (inst as any).updateCachedStatus();
    // Проверяем, что не было вызова с 0 (undefined fan_mode)
    expect(service.updateCharacteristic).not.toHaveBeenCalledWith('RotationSpeed', 0);
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
    expect(accessory.getService).toHaveBeenCalledWith(platform.Service.Fan);
  });
});
