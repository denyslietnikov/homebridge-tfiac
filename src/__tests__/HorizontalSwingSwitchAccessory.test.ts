import { HorizontalSwingSwitchAccessory } from '../HorizontalSwingSwitchAccessory';
import { TfiacPlatform } from '../platform';
import { PlatformAccessory, Service } from 'homebridge';

describe('HorizontalSwingSwitchAccessory', () => {
  const mockService: any = {
    setCharacteristic: jest.fn().mockReturnThis(),
    getCharacteristic: jest.fn().mockReturnValue({ on: jest.fn().mockReturnThis() }),
    updateCharacteristic: jest.fn(),
    on: jest.fn().mockReturnThis(),
    emit: jest.fn(),
    displayName: 'MockService',
    UUID: 'mock-uuid',
    iid: 1,
  };

  const makeAccessory = (): PlatformAccessory =>
    ({
      context: { deviceConfig: { name: 'AC', ip: '1.2.3.4', updateInterval: 1 } },
      getService: jest.fn().mockReturnValue(null),
      addService: jest.fn().mockReturnValue(mockService),
      getServiceById: jest.fn(),
    } as unknown as PlatformAccessory);

  const mockPlatform = (): TfiacPlatform =>
    ({
      Service: { Switch: jest.fn() },
      Characteristic: { Name: 'Name', On: 'On' },
      log: { debug: jest.fn(), error: jest.fn(), info: jest.fn() },
    } as unknown as TfiacPlatform);

  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let service: Service;
  let deviceAPI: any;
  let log: any;

  beforeEach(() => {
    log = { debug: jest.fn(), error: jest.fn(), info: jest.fn() };
    platform = mockPlatform();
    service = mockService;
    accessory = makeAccessory();
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
    const deviceName = accessory.context.deviceConfig.name;
    expect(accessory.addService).toHaveBeenCalledWith(platform.Service.Switch, deviceName + ' Horizontal Swing', 'horizontalswing');
    expect(service.setCharacteristic).toHaveBeenCalledWith('Name', deviceName + ' Horizontal Swing');
  });

  it('should stop polling and cleanup', () => {
    const inst = new HorizontalSwingSwitchAccessory(platform, accessory);
    (inst as any).pollingInterval = setInterval(() => {}, 1000);
    inst.stopPolling();
    expect(deviceAPI.cleanup).toHaveBeenCalled();
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