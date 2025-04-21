import { SleepSwitchAccessory } from '../SleepSwitchAccessory';
import { TfiacPlatform } from '../platform';
import { PlatformAccessory, Service } from 'homebridge';

describe('SleepSwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let service: Service;
  let deviceAPI: any;
  let log: any;

  beforeEach(() => {
    log = { debug: jest.fn(), error: jest.fn() };
    platform = {
      Service: { Switch: jest.fn() },
      Characteristic: { Name: 'Name', On: 'On' },
      log,
    } as any;
    service = {
      setCharacteristic: jest.fn(),
      getCharacteristic: jest.fn().mockReturnThis(),
      on: jest.fn().mockReturnThis(),
      updateCharacteristic: jest.fn(),
    } as any;
    accessory = {
      context: { deviceConfig: { ip: '1.2.3.4', port: 1234, updateInterval: 1, name: 'Test' } },
      getService: jest.fn().mockReturnValue(undefined),
      addService: jest.fn().mockReturnValue(service),
    } as any;
    deviceAPI = {
      updateState: jest.fn().mockResolvedValue({ opt_sleepMode: 'on' }),
      setSleepState: jest.fn().mockResolvedValue(undefined),
      cleanup: jest.fn(),
    };
    jest.spyOn(require('../AirConditionerAPI'), 'default').mockImplementation(() => deviceAPI);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('should construct and set up polling and handlers', () => {
    const inst = new SleepSwitchAccessory(platform, accessory);
    expect(accessory.addService).toHaveBeenCalled();
    expect(service.setCharacteristic).toHaveBeenCalledWith('Name', 'Sleep');
    expect(service.on).toHaveBeenCalled();
  });

  it('should stop polling and cleanup', () => {
    const inst = new SleepSwitchAccessory(platform, accessory);
    (inst as any).pollingInterval = setInterval(() => {}, 1000);
    inst.stopPolling();
    expect(deviceAPI.cleanup).toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalled();
  });

  it('should update cached status and update characteristic', async () => {
    const inst = new SleepSwitchAccessory(platform, accessory);
    await (inst as any).updateCachedStatus();
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', true);
  });

  it('should handle get with cached status (on)', done => {
    const inst = new SleepSwitchAccessory(platform, accessory);
    (inst as any).cachedStatus = {
      opt_sleepMode: 'on',
      current_temp: 0,
      target_temp: 0,
      operation_mode: '',
      fan_mode: '',
      swing_mode: '',
      opt_display: '',
    };
    (inst as any).handleGet((err: any, val: any) => {
      expect(err).toBeNull();
      expect(val).toBe(true);
      done();
    });
  });

  it('should handle get with cached status (off)', done => {
    const inst = new SleepSwitchAccessory(platform, accessory);
    (inst as any).cachedStatus = {
      opt_sleepMode: 'off',
      current_temp: 0,
      target_temp: 0,
      operation_mode: '',
      fan_mode: '',
      swing_mode: '',
      opt_display: '',
    };
    (inst as any).handleGet((err: any, val: any) => {
      expect(err).toBeNull();
      expect(val).toBe(false);
      done();
    });
  });

  it('should handle get with no cached status', done => {
    const inst = new SleepSwitchAccessory(platform, accessory);
    (inst as any).cachedStatus = null;
    (inst as any).handleGet((err: any, val: any) => {
      // Now expecting default value (false) instead of an error
      expect(err).toBeNull();
      expect(val).toBe(false);
      done();
    });
  });

  it('should handle set and update status', async () => {
    const inst = new SleepSwitchAccessory(platform, accessory);
    const cb = jest.fn();
    await (inst as any).handleSet(true, cb);
    expect(deviceAPI.setSleepState).toHaveBeenCalledWith('on');
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('should handle set error', async () => {
    deviceAPI.setSleepState.mockRejectedValueOnce(new Error('fail'));
    const inst = new SleepSwitchAccessory(platform, accessory);
    const cb = jest.fn();
    await (inst as any).handleSet(true, cb);
    expect(cb).toHaveBeenCalledWith(expect.any(Error));
  });
});