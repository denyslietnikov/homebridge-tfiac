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
    expect(accessory.addService).toHaveBeenCalledWith(platform.Service.Switch, 'Sleep', 'sleep');
    expect(service.setCharacteristic).toHaveBeenCalledWith('Name', 'Sleep');
    expect(service.getCharacteristic).toHaveBeenCalledWith('On');
    expect(service.on).toHaveBeenCalledTimes(2);
  });

  it('should initialize correctly and add a new service', () => {
    const inst = createAccessoryWithMockedUpdate();
    const platformAcc = (inst as any).accessory as PlatformAccessory;
    const svc = (inst as any).service;
    const deviceName = platformAcc.context.deviceConfig.name;
    expect(platformAcc.addService).toHaveBeenCalledWith(expect.any(Function), 'Sleep', 'sleep');
    expect(svc.setCharacteristic).toHaveBeenCalledWith('Name', 'Sleep');
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
    jest.clearAllMocks();
    const mockAccessory = makeAccessory();
    const platformInstance = mockPlatform();
    (mockAccessory.getService as jest.Mock).mockReturnValue(existingMockService);
    const sleepAccessory = new SleepSwitchAccessory(platformInstance, mockAccessory);
    expect(mockAccessory.getService).toHaveBeenCalledWith('Sleep');
    expect(mockAccessory.addService).not.toHaveBeenCalled();
    expect(existingMockService.setCharacteristic).toHaveBeenCalledWith(platformInstance.Characteristic.Name, 'Sleep');
    expect(existingMockService.getCharacteristic).toHaveBeenCalledWith(platformInstance.Characteristic.On);
    expect(existingMockService.getCharacteristic().on).toHaveBeenCalledWith('get', expect.any(Function));
    expect(existingMockService.getCharacteristic().on).toHaveBeenCalledWith('set', expect.any(Function));
  });

  it('handleGet returns true if opt_sleepMode starts with sleepMode', done => {
    const inst = new SleepSwitchAccessory(platform, accessory);
    (inst as any).cachedStatus = { opt_sleepMode: 'sleepMode1:active' };
    (inst as any).handleGet((err: Error | null, value?: boolean) => {
      expect(err).toBeNull();
      expect(value).toBe(true);
      done();
    });
  });

  it('handleGet returns false if opt_sleepMode does not start with sleepMode', done => {
    const inst = new SleepSwitchAccessory(platform, accessory);
    (inst as any).cachedStatus = { opt_sleepMode: 'off' };
    (inst as any).handleGet((err: Error | null, value?: boolean) => {
      expect(err).toBeNull();
      expect(value).toBe(false);
      done();
    });
  });

  it('handleGet returns false if opt_sleepMode is undefined', done => {
    const inst = new SleepSwitchAccessory(platform, accessory);
    (inst as any).cachedStatus = {};
    (inst as any).handleGet((err: Error | null, value?: boolean) => {
      expect(err).toBeNull();
      expect(value).toBe(false);
      done();
    });
  });

  it('updateCachedStatus updates characteristic when opt_sleepMode changes', async () => {
    const inst = new SleepSwitchAccessory(platform, accessory);
    (inst as any).cachedStatus = { opt_sleepMode: 'off' };
    deviceAPI.updateState.mockResolvedValueOnce({ opt_sleepMode: 'sleepMode2:active' });
    await (inst as any).updateCachedStatus();
    expect(service.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, true);
  });

  it('updateCachedStatus does not update characteristic if opt_sleepMode unchanged', async () => {
    const inst = new SleepSwitchAccessory(platform, accessory);
    (inst as any).cachedStatus = { opt_sleepMode: 'sleepMode1:active' };
    deviceAPI.updateState.mockResolvedValueOnce({ opt_sleepMode: 'sleepMode1:active' });
    await (inst as any).updateCachedStatus();
    expect(service.updateCharacteristic).not.toHaveBeenCalledWith(platform.Characteristic.On, expect.anything());
  });

  it('updateCachedStatus handles error from updateState', async () => {
    const inst = new SleepSwitchAccessory(platform, accessory);
    deviceAPI.updateState.mockRejectedValueOnce(new Error('fail'));
    await (inst as any).updateCachedStatus();
    expect(platform.log.error).toHaveBeenCalledWith(
      expect.stringContaining('Error updating Sleep status'),
      expect.any(Error)
    );
  });
});