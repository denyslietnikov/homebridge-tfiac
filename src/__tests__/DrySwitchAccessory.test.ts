import { PlatformAccessory, Service, Characteristic, CharacteristicValue, CharacteristicGetCallback, CharacteristicSetCallback, HapStatusError, WithUUID } from 'homebridge'; // Removed HAPConnection
import { TfiacPlatform } from '../platform.js';
import { DrySwitchAccessory } from '../DrySwitchAccessory.js';
import AirConditionerAPI, { AirConditionerStatus } from '../AirConditionerAPI.js';
import CacheManager from '../CacheManager.js';
import { TfiacDeviceConfig } from '../settings.js';

jest.mock('../AirConditionerAPI.js');
jest.mock('../CacheManager.js');

// Explicitly type the mocked module
const MockedAirConditionerAPI = AirConditionerAPI as jest.MockedClass<typeof AirConditionerAPI>;
const MockedCacheManager = CacheManager as jest.Mocked<typeof CacheManager>;

describe('DrySwitchAccessory - unit', () => {
  let platform: TfiacPlatform;
  let accessory: jest.Mocked<PlatformAccessory>;
  let mockService: jest.Mocked<Service>;
  let mockCharacteristic: jest.Mocked<Characteristic>;
  let mockCacheManager: jest.Mocked<CacheManager>;
  let inst: DrySwitchAccessory;

  const mockCharacteristicOn = {
    on: jest.fn().mockReturnThis(),
    updateValue: jest.fn(),
    setProps: jest.fn().mockReturnThis(),
  } as unknown as jest.Mocked<Characteristic>;

  const mockServiceInstance = {
    getCharacteristic: jest.fn().mockImplementation((char) => {
      if (char === mockPlatformInstance.Characteristic.On) {
        return mockCharacteristicOn;
      }
      return {
        on: jest.fn().mockReturnThis(),
        updateValue: jest.fn(),
        setProps: jest.fn().mockReturnThis(),
      } as unknown as jest.Mocked<Characteristic>;
    }),
    setCharacteristic: jest.fn().mockReturnThis(),
    updateCharacteristic: jest.fn(),
  } as unknown as jest.Mocked<Service>;

  const mockPlatformInstance = {
    log: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    api: {
      hap: {
        Service: {
          Switch: jest.fn().mockImplementation(() => mockServiceInstance),
        },
        Characteristic: {
          On: jest.fn(),
          Name: jest.fn(),
        },
      },
    },
    Service: {
      Switch: jest.fn().mockImplementation(() => mockServiceInstance),
    },
    Characteristic: {
      On: mockCharacteristicOn,
      Name: jest.fn(),
    },
  } as unknown as TfiacPlatform;

  beforeEach(() => {
    jest.clearAllMocks(); // Clear all mocks including instances

    platform = mockPlatformInstance;
    mockService = mockServiceInstance;
    mockCharacteristic = mockCharacteristicOn;

    accessory = {
      getService: jest.fn(),
      getServiceById: jest.fn(),
      addService: jest.fn().mockReturnValue(mockService),
      context: {
        deviceConfig: {
          ip: '192.168.1.101',
          port: 8081,
          name: 'AC',
          updateInterval: 15,
        } as TfiacDeviceConfig,
      },
      displayName: 'AC Display Name',
    } as unknown as jest.Mocked<PlatformAccessory>;

    // Adjust CacheManager mock definition and casting
    mockCacheManager = {
      getStatus: jest.fn(),
      clear: jest.fn(),
      cleanup: jest.fn(), // Added cleanup mock
      // Add other properties if needed by tests, or keep minimal
    } as unknown as jest.Mocked<CacheManager>; // Use 'as unknown as'
    MockedCacheManager.getInstance.mockReturnValue(mockCacheManager);

    // Instantiate the accessory - this calls the mocked AirConditionerAPI constructor
    inst = new DrySwitchAccessory(platform, accessory);

    // Stop polling etc.
    inst.stopPolling();
    (inst as any).pollingInterval = null;

    // Clear specific mocks if needed after instantiation (optional, clearAllMocks might be enough)
    (accessory.getServiceById as jest.Mock).mockClear();
    (accessory.getService as jest.Mock).mockClear();
    (accessory.addService as jest.Mock).mockClear();
    (mockService.setCharacteristic as jest.Mock).mockClear();
    (mockService.getCharacteristic as jest.Mock).mockClear();
    (mockCharacteristic.on as jest.Mock).mockClear();
    (mockCacheManager.getStatus as jest.Mock).mockClear();
    (mockCacheManager.clear as jest.Mock).mockClear();

    // Clear calls on the API mock instance if it exists
    const deviceAPIMockInstance = MockedAirConditionerAPI.mock.instances[0] as jest.Mocked<AirConditionerAPI>;
    if (deviceAPIMockInstance) {
      (deviceAPIMockInstance.setAirConditionerState as jest.Mock).mockClear();
    }
  });

  it('should construct, add service, and set up handlers', () => {
    jest.clearAllMocks();
    (accessory.getServiceById as jest.Mock).mockReturnValue(undefined);
    (accessory.getService as jest.Mock).mockReturnValue(undefined);
    (accessory.addService as jest.Mock).mockReturnValue(mockService);

    inst = new DrySwitchAccessory(platform, accessory);

    expect(accessory.getServiceById).toHaveBeenCalledWith(platform.Service.Switch.UUID, 'dry');
    expect(accessory.addService).toHaveBeenCalledWith(platform.Service.Switch, 'Dry', 'dry');
    expect(mockService.setCharacteristic).toHaveBeenCalledWith(platform.Characteristic.Name, 'Dry');
    expect(mockService.getCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On);
    expect(mockCharacteristic.on).toHaveBeenCalledWith('get', expect.any(Function));
    expect(mockCharacteristic.on).toHaveBeenCalledWith('set', expect.any(Function));
  });

  it('should use existing service if available by ID', () => {
    jest.clearAllMocks();
    (accessory.getServiceById as jest.Mock).mockReturnValue(mockService);
    (accessory.getService as jest.Mock).mockReturnValue(undefined);
    (accessory.addService as jest.Mock).mockClear();

    inst = new DrySwitchAccessory(platform, accessory);

    expect(accessory.getServiceById).toHaveBeenCalledWith(platform.Service.Switch.UUID, 'dry');
    expect(accessory.getService).not.toHaveBeenCalled();
    expect(accessory.addService).not.toHaveBeenCalled();
    expect(mockService.setCharacteristic).toHaveBeenCalledWith(platform.Characteristic.Name, 'Dry');
    expect(mockService.getCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On);
    expect(mockCharacteristic.on).toHaveBeenCalledWith('get', expect.any(Function));
    expect(mockCharacteristic.on).toHaveBeenCalledWith('set', expect.any(Function));
  });

  it('should use existing service if available by Name (fallback)', () => {
    jest.clearAllMocks();
    (accessory.getServiceById as jest.Mock).mockReturnValue(undefined);
    (accessory.getService as jest.Mock).mockReturnValue(mockService);
    (accessory.addService as jest.Mock).mockClear();

    inst = new DrySwitchAccessory(platform, accessory);

    expect(accessory.getServiceById).toHaveBeenCalledWith(platform.Service.Switch.UUID, 'dry');
    expect(accessory.getService).toHaveBeenCalledWith('Dry');
    expect(accessory.addService).not.toHaveBeenCalled();
    expect(mockService.setCharacteristic).toHaveBeenCalledWith(platform.Characteristic.Name, 'Dry');
    expect(mockService.getCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On);
    expect(mockCharacteristic.on).toHaveBeenCalledWith('get', expect.any(Function));
    expect(mockCharacteristic.on).toHaveBeenCalledWith('set', expect.any(Function));
  });

  it('handleGet returns correct value (true)', (done) => {
    (inst as any).cachedStatus = { operation_mode: 'dehumi' };
    (inst as any).handleGet((err: Error | null | undefined, value?: CharacteristicValue) => {
      expect(err).toBeNull();
      expect(value).toBe(true);
      done();
    });
  });

  it('handleGet returns correct value (false)', (done) => {
    (inst as any).cachedStatus = { operation_mode: 'auto' };
    (inst as any).handleGet((err: Error | null | undefined, value?: CharacteristicValue) => {
      expect(err).toBeNull();
      expect(value).toBe(false);
      done();
    });
  });

  it('handleSet turns mode on (dehumi) and off (auto)', async () => {
    const deviceAPIMockInstance = MockedAirConditionerAPI.mock.instances[0] as jest.Mocked<AirConditionerAPI>;
    const cb = jest.fn();

    await (inst as any).handleSet(true, cb);
    expect(deviceAPIMockInstance.setAirConditionerState).toHaveBeenCalledWith('operation_mode', 'dehumi');
    expect(cb).toHaveBeenCalledWith(null);
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, true);

    (deviceAPIMockInstance.setAirConditionerState as jest.Mock).mockClear();
    cb.mockClear();
    (mockService.updateCharacteristic as jest.Mock).mockClear();

    await (inst as any).handleSet(false, cb);
    expect(deviceAPIMockInstance.setAirConditionerState).toHaveBeenCalledWith('operation_mode', 'auto');
    expect(cb).toHaveBeenCalledWith(null);
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, false);
  });

  it('updateCachedStatus updates characteristic on change', async () => {
    (inst as any).cachedStatus = { operation_mode: 'auto' };
    mockCacheManager.getStatus.mockResolvedValueOnce({ operation_mode: 'dehumi' } as any);
    await (inst as any).updateCachedStatus();
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, true);
  });

  it('updateCachedStatus does not update characteristic if unchanged', async () => {
    (inst as any).cachedStatus = { operation_mode: 'dehumi' };
    mockCacheManager.getStatus.mockResolvedValueOnce({ operation_mode: 'dehumi' } as any);
    (mockService.updateCharacteristic as jest.Mock).mockClear();
    await (inst as any).updateCachedStatus();
    expect(mockService.updateCharacteristic).not.toHaveBeenCalled();
  });

  it('updateCachedStatus logs error on failure', async () => {
    const error = new Error('fail');
    mockCacheManager.getStatus.mockRejectedValueOnce(error);
    const logErrorSpy = platform.log.error as jest.Mock;
    await (inst as any).updateCachedStatus();
    expect(logErrorSpy).toHaveBeenCalledWith(
      `Error updating Dry status for ${accessory.displayName}:`,
      error,
    );
  });
});