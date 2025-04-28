import { DisplaySwitchAccessory } from '../DisplaySwitchAccessory.js';
import { TfiacPlatform } from '../platform.js';
import { PlatformAccessory, Service } from 'homebridge';

describe('DisplaySwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let service: Service;
  let deviceAPI: any;
  let log: any;

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

  beforeEach(() => {
    log = { debug: jest.fn(), error: jest.fn(), info: jest.fn() };
    platform = mockPlatform();
    service = mockService;
    accessory = makeAccessory();
    deviceAPI = {
      updateState: jest.fn().mockResolvedValue({ opt_display: 'on' }),
      setDisplayState: jest.fn().mockResolvedValue(undefined),
      cleanup: jest.fn(),
    };
    jest.spyOn(require('../AirConditionerAPI'), 'default').mockImplementation(() => deviceAPI);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('should construct and set up polling and handlers', () => {
    const inst = new DisplaySwitchAccessory(platform, accessory);
    expect(accessory.addService).toHaveBeenCalledWith(platform.Service.Switch, 'Display', 'display');
    expect(service.setCharacteristic).toHaveBeenCalledWith('Name', 'Display');
    expect(service.getCharacteristic).toHaveBeenCalledWith('On');
  });

  it('should stop polling and cleanup', () => {
    const inst = new DisplaySwitchAccessory(platform, accessory);
    (inst as any).pollingInterval = setInterval(() => {}, 1000);
    inst.stopPolling();
    expect(deviceAPI.cleanup).toHaveBeenCalled();
  });

  it('should update cached status and update characteristic', async () => {
    const inst = new DisplaySwitchAccessory(platform, accessory);
    await (inst as any).updateCachedStatus();
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', true);
  });

  it('should handle get with cached status', done => {
    const inst = new DisplaySwitchAccessory(platform, accessory);
    (inst as any).cachedStatus = {
      opt_display: 'on',
      current_temp: 0,
      target_temp: 0,
      operation_mode: '',
      fan_mode: '',
      swing_mode: '',
      opt_sleepMode: '',
    };
    (inst as any).handleGet((err: any, val: any) => {
      expect(err).toBeNull();
      expect(val).toBe(true);
      done();
    });
  });

  it('should handle get with no cached status', done => {
    const inst = new DisplaySwitchAccessory(platform, accessory);
    (inst as any).cachedStatus = null;
    (inst as any).handleGet((err: any, val: any) => {
      // Now expecting default value (false) instead of an error
      expect(err).toBeNull();
      expect(val).toBe(false);
      done();
    });
  });

  it('should handle set and update status', async () => {
    const inst = new DisplaySwitchAccessory(platform, accessory);
    const cb = jest.fn();
    await (inst as any).handleSet(true, cb);
    expect(deviceAPI.setDisplayState).toHaveBeenCalledWith('on');
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('should handle set error', async () => {
    deviceAPI.setDisplayState.mockRejectedValueOnce(new Error('fail'));
    const inst = new DisplaySwitchAccessory(platform, accessory);
    const cb = jest.fn();
    await (inst as any).handleSet(true, cb);
    expect(cb).toHaveBeenCalledWith(expect.any(Error));
  });
});