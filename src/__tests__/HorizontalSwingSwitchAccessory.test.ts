import { HorizontalSwingSwitchAccessory } from '../HorizontalSwingSwitchAccessory';
import { TfiacPlatform } from '../platform';
import { PlatformAccessory, Service } from 'homebridge';

describe('HorizontalSwingSwitchAccessory', () => {
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
      updateState: jest.fn().mockResolvedValue({ swing_mode: 'Horizontal' }),
      setSwingMode: jest.fn().mockResolvedValue(undefined),
      cleanup: jest.fn(),
    };
    jest.spyOn(require('../AirConditionerAPI'), 'default').mockImplementation(() => deviceAPI);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('should construct and set up polling and handlers', () => {
    const inst = new HorizontalSwingSwitchAccessory(platform, accessory);
    expect(accessory.addService).toHaveBeenCalledWith(platform.Service.Switch, 'Horizontal Swing', 'horizontal_swing');
    expect(service.setCharacteristic).toHaveBeenCalledWith('Name', 'Horizontal Swing');
    expect(service.on).toHaveBeenCalled();
  });

  it('should stop polling and cleanup', () => {
    const inst = new HorizontalSwingSwitchAccessory(platform, accessory);
    (inst as any).pollingInterval = setInterval(() => {}, 1000);
    inst.stopPolling();
    expect(deviceAPI.cleanup).toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalled();
  });

  it('should update cached status and update characteristic for Horizontal mode', async () => {
    const inst = new HorizontalSwingSwitchAccessory(platform, accessory);
    await (inst as any).updateCachedStatus();
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', true);
  });

  it('should update cached status and update characteristic for Both mode', async () => {
    deviceAPI.updateState.mockResolvedValueOnce({ swing_mode: 'Both' });
    const inst = new HorizontalSwingSwitchAccessory(platform, accessory);
    await (inst as any).updateCachedStatus();
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', true);
  });

  it('should update cached status and update characteristic for Off mode', async () => {
    deviceAPI.updateState.mockResolvedValueOnce({ swing_mode: 'Off' });
    const inst = new HorizontalSwingSwitchAccessory(platform, accessory);
    await (inst as any).updateCachedStatus();
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', false);
  });

  it('should update cached status and update characteristic for Vertical mode', async () => {
    deviceAPI.updateState.mockResolvedValueOnce({ swing_mode: 'Vertical' });
    const inst = new HorizontalSwingSwitchAccessory(platform, accessory);
    await (inst as any).updateCachedStatus();
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', false);
  });

  it('should handle error during update cached status', async () => {
    deviceAPI.updateState.mockRejectedValueOnce(new Error('Network error'));
    const inst = new HorizontalSwingSwitchAccessory(platform, accessory);
    await (inst as any).updateCachedStatus();
    expect(log.error).toHaveBeenCalled();
  });

  it('should handle get with cached status for Horizontal mode', done => {
    const inst = new HorizontalSwingSwitchAccessory(platform, accessory);
    (inst as any).cachedStatus = { swing_mode: 'Horizontal' };
    (inst as any).handleGet((err: any, val: any) => {
      expect(err).toBeNull();
      expect(val).toBe(true);
      done();
    });
  });

  it('should handle get with cached status for Both mode', done => {
    const inst = new HorizontalSwingSwitchAccessory(platform, accessory);
    (inst as any).cachedStatus = { swing_mode: 'Both' };
    (inst as any).handleGet((err: any, val: any) => {
      expect(err).toBeNull();
      expect(val).toBe(true);
      done();
    });
  });

  it('should handle get with cached status for Off mode', done => {
    const inst = new HorizontalSwingSwitchAccessory(platform, accessory);
    (inst as any).cachedStatus = { swing_mode: 'Off' };
    (inst as any).handleGet((err: any, val: any) => {
      expect(err).toBeNull();
      expect(val).toBe(false);
      done();
    });
  });

  it('should handle get with cached status for Vertical mode', done => {
    const inst = new HorizontalSwingSwitchAccessory(platform, accessory);
    (inst as any).cachedStatus = { swing_mode: 'Vertical' };
    (inst as any).handleGet((err: any, val: any) => {
      expect(err).toBeNull();
      expect(val).toBe(false);
      done();
    });
  });

  it('should handle get with no cached status', done => {
    const inst = new HorizontalSwingSwitchAccessory(platform, accessory);
    (inst as any).cachedStatus = null;
    (inst as any).handleGet((err: any, val: any) => {
      // Now expecting default value (false) instead of error
      expect(err).toBeNull();
      expect(val).toBe(false);
      done();
    });
  });

  it('should handle set ON when vertical is OFF', async () => {
    const inst = new HorizontalSwingSwitchAccessory(platform, accessory);
    (inst as any).cachedStatus = { swing_mode: 'Off' };
    const cb = jest.fn();
    await (inst as any).handleSet(true, cb);
    expect(deviceAPI.setSwingMode).toHaveBeenCalledWith('Horizontal');
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('should handle set ON when vertical is ON', async () => {
    const inst = new HorizontalSwingSwitchAccessory(platform, accessory);
    (inst as any).cachedStatus = { swing_mode: 'Vertical' };
    const cb = jest.fn();
    await (inst as any).handleSet(true, cb);
    expect(deviceAPI.setSwingMode).toHaveBeenCalledWith('Both');
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('should handle set OFF when both are ON', async () => {
    const inst = new HorizontalSwingSwitchAccessory(platform, accessory);
    (inst as any).cachedStatus = { swing_mode: 'Both' };
    const cb = jest.fn();
    await (inst as any).handleSet(false, cb);
    expect(deviceAPI.setSwingMode).toHaveBeenCalledWith('Vertical');
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('should handle set OFF when only horizontal is ON', async () => {
    const inst = new HorizontalSwingSwitchAccessory(platform, accessory);
    (inst as any).cachedStatus = { swing_mode: 'Horizontal' };
    const cb = jest.fn();
    await (inst as any).handleSet(false, cb);
    expect(deviceAPI.setSwingMode).toHaveBeenCalledWith('Off');
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('should handle set error', async () => {
    deviceAPI.setSwingMode.mockRejectedValueOnce(new Error('fail'));
    const inst = new HorizontalSwingSwitchAccessory(platform, accessory);
    const cb = jest.fn();
    await (inst as any).handleSet(true, cb);
    expect(cb).toHaveBeenCalledWith(expect.any(Error));
  });
});