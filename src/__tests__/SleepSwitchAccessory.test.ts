import { SleepSwitchAccessory } from '../SleepSwitchAccessory';
import { TfiacPlatform } from '../platform';
import { PlatformAccessory, Service } from 'homebridge';

describe('SleepSwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let service: Service;
  let deviceAPI: any;
  let log: any;

  const mockService = {
    setCharacteristic: jest.fn().mockReturnThis(),
    getCharacteristic: jest.fn().mockReturnValue({ on: jest.fn().mockReturnThis() }),
    updateCharacteristic: jest.fn(),
    on: jest.fn().mockReturnThis(),
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

  // Helper function to create accessory with an overridden updateCachedStatus method
  let mockUpdateCachedStatus: jest.Mock;
  const createAccessoryWithMockedUpdate = (existingService?: any) => {
    const accInstance = makeAccessory();
    if (existingService) {
      (accInstance.getService as jest.Mock).mockReturnValue(existingService);
    }
    const acc = new SleepSwitchAccessory(mockPlatform(), accInstance);
    // Replace the method after construction
    if (!mockUpdateCachedStatus) {
      mockUpdateCachedStatus = jest.fn().mockResolvedValue(undefined);
    }
    Object.defineProperty(acc, 'updateCachedStatus', {
      value: mockUpdateCachedStatus
    });
    return acc;
  };

  beforeEach(() => {
    log = { debug: jest.fn(), error: jest.fn(), info: jest.fn() };
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
      getServiceById: jest.fn(),
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
    expect(service.setCharacteristic).toHaveBeenCalledWith('Name', 'Test Sleep');
    expect(service.on).toHaveBeenCalled();
  });

  it('should initialize correctly and add a new service', () => {
    const inst = createAccessoryWithMockedUpdate();
    const platformAcc = (inst as any).accessory as PlatformAccessory;
    const svc = (inst as any).service;
    const deviceName = platformAcc.context.deviceConfig.name;
    expect(platformAcc.addService).toHaveBeenCalledWith(expect.any(Function), deviceName + ' Sleep', 'sleep');
    expect(svc.setCharacteristic).toHaveBeenCalledWith('Name', deviceName + ' Sleep');
    expect(svc.getCharacteristic).toHaveBeenCalledWith('On');
    expect(svc.getCharacteristic().on).toHaveBeenCalledWith('get', expect.any(Function));
    expect(svc.getCharacteristic().on).toHaveBeenCalledWith('set', expect.any(Function));
  });

  it('should use existing service if available', () => {
    const existingMockService = {
      setCharacteristic: jest.fn().mockReturnThis(),
      getCharacteristic: jest.fn().mockReturnValue({ on: jest.fn().mockReturnThis() }),
      updateCharacteristic: jest.fn(),
    };
    const inst = createAccessoryWithMockedUpdate(existingMockService);
    const platformAcc = (inst as any).accessory as PlatformAccessory;
    const svc = (inst as any).service;
    const deviceName = platformAcc.context.deviceConfig.name;
    expect(platformAcc.getService).toHaveBeenCalledWith(deviceName + ' Sleep');
    expect(platformAcc.addService).not.toHaveBeenCalled();
    expect(svc.setCharacteristic).toHaveBeenCalledWith('Name', deviceName + ' Sleep');
    expect(svc.getCharacteristic).toHaveBeenCalledWith('On');
    expect(svc.getCharacteristic().on).toHaveBeenCalledWith('get', expect.any(Function));
    expect(svc.getCharacteristic().on).toHaveBeenCalledWith('set', expect.any(Function));
  });

  it('should stop polling and cleanup', () => {
    const inst = new SleepSwitchAccessory(platform, accessory);
    (inst as any).pollingInterval = setInterval(() => {}, 1000);
    inst.stopPolling();
    expect(deviceAPI.cleanup).toHaveBeenCalled();
  });

  it('should start polling', () => {
    const inst = new SleepSwitchAccessory(platform, accessory);
  });

  it('should update cached status and update characteristic', async () => {
    const inst = new SleepSwitchAccessory(platform, accessory);
    await (inst as any).updateCachedStatus();
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', false);
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
      expect(val).toBe(false);
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
      expect(err).toBeNull();
      expect(val).toBe(false);
      done();
    });
  });

  it('should handle exception in handleGet callback', done => {
    const inst = new SleepSwitchAccessory(platform, accessory);
    Object.defineProperty(inst as any, 'cachedStatus', { get: () => { throw new Error('Test error'); } });
    try {
      (inst as any).handleGet((err: any, val: any) => {
        done.fail('Callback should not be called');
      });
      done.fail('Error should have been thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      if (err && typeof err === 'object' && 'message' in err) {
        expect((err as Error).message).toBe('Test error');
      }
      done();
    }
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

  it('should handle errors when updating cached status', async () => {
    const apiError = new Error('API Error');
    deviceAPI.updateState.mockRejectedValueOnce(apiError);
    const sleepAccessory = new SleepSwitchAccessory(platform, accessory);
    await (sleepAccessory as any).updateCachedStatus();
  });

  it('should handle null cached status in handleGet', (done) => {
    const sleepAccessory = new SleepSwitchAccessory(platform, accessory);
    (sleepAccessory as any).cachedStatus = null;
    (sleepAccessory as any).handleGet((err: Error | null, value: any) => {
      expect(err).toBeNull();
      expect(value).toBe(false);
      done();
    });
  });

  it('should handle API errors in handleSet', async () => {
    const apiError = new Error('API Error');
    deviceAPI.setSleepState.mockRejectedValueOnce(apiError);
    const sleepAccessory = new SleepSwitchAccessory(platform, accessory);
    const callback = jest.fn();
    await (sleepAccessory as any).handleSet(true, callback);
    expect(callback).toHaveBeenCalledWith(apiError);
  });

  it('should properly call setSleepState with the correct value', async () => {
    const sleepAccessory = new SleepSwitchAccessory(platform, accessory);
    const callback = jest.fn();
    await (sleepAccessory as any).handleSet(true, callback);
    expect(deviceAPI.setSleepState).toHaveBeenCalledWith('on');
    expect(callback).toHaveBeenCalledWith(null);
    deviceAPI.setSleepState.mockClear();
    callback.mockClear();
    await (sleepAccessory as any).handleSet(false, callback);
    expect(deviceAPI.setSleepState).toHaveBeenCalledWith('off');
    expect(callback).toHaveBeenCalledWith(null);
  });

  it('should handle different cached sleep state values', (done) => {
    const sleepAccessory = new SleepSwitchAccessory(platform, accessory);
    (sleepAccessory as any).cachedStatus = { opt_sleepMode: 'on' };
    (sleepAccessory as any).handleGet((err: Error | null, value: any) => {
      expect(err).toBeNull();
      expect(value).toBe(false);
      (sleepAccessory as any).cachedStatus = { opt_sleepMode: 'off' };
      (sleepAccessory as any).handleGet((err2: Error | null, value2: any) => {
        expect(err2).toBeNull();
        expect(value2).toBe(false);
        (sleepAccessory as any).cachedStatus = { opt_sleepMode: '' };
        (sleepAccessory as any).handleGet((err3: Error | null, value3: any) => {
          expect(err3).toBeNull();
          expect(value3).toBe(false);
          done();
        });
      });
    });
  });

  it('should handle when enableSleep is set to false', () => {
    accessory.context.deviceConfig.enableSleep = false;
    const sleepAccessory = new SleepSwitchAccessory(platform, accessory);
    expect(accessory.getService).toHaveBeenCalled();
    expect(accessory.addService).toHaveBeenCalled();
  });

  it('should handle stopPolling when pollingInterval is not set', () => {
    const sleepAccessory = new SleepSwitchAccessory(platform, accessory);
    (sleepAccessory as any).pollingInterval = null;
    sleepAccessory.stopPolling();
    expect(deviceAPI.cleanup).toHaveBeenCalled();
  });

  it('should handle stopPolling when deviceAPI is not initialized', () => {
    accessory.context.deviceConfig.enableSleep = false;
    const sleepAccessory = new SleepSwitchAccessory(platform, accessory);
    (sleepAccessory as any).deviceAPI = undefined;
    expect(() => sleepAccessory.stopPolling()).not.toThrow();
  });

  it('should handle updateCachedStatus when service is not initialized', async () => {
    accessory.context.deviceConfig.enableSleep = false;
    const sleepAccessory = new SleepSwitchAccessory(platform, accessory);
    (sleepAccessory as any).service = undefined;
    (sleepAccessory as any).deviceAPI = deviceAPI;
    await (sleepAccessory as any).updateCachedStatus();
    expect(service.updateCharacteristic).not.toHaveBeenCalled();
  });

  it('should handle updateCachedStatus when status.opt_sleepMode is undefined', async () => {
    deviceAPI.updateState.mockResolvedValueOnce({ current_temp: 70, operation_mode: 'cool' });
    const sleepAccessory = new SleepSwitchAccessory(platform, accessory);
    jest.clearAllMocks();
    await (sleepAccessory as any).updateCachedStatus();
  });

  it('should initialize with custom poll interval', () => {
    accessory.context.deviceConfig.updateInterval = 10;
    const sleepAccessory = new SleepSwitchAccessory(platform, accessory);
  });

  it('should use default poll interval when not specified', () => {
    delete accessory.context.deviceConfig.updateInterval;
    const sleepAccessory = new SleepSwitchAccessory(platform, accessory);
  });
});