import { PlatformAccessory, Service, Characteristic, CharacteristicValue, CharacteristicGetCallback, CharacteristicSetCallback, HapStatusError, WithUUID } from 'homebridge'; // Removed HAPConnection
import { TfiacPlatform } from '../platform.js';
import { SleepSwitchAccessory } from '../SleepSwitchAccessory.js';
import AirConditionerAPI, { AirConditionerStatus } from '../AirConditionerAPI.js';
import CacheManager from '../CacheManager.js';
import { TfiacDeviceConfig } from '../settings.js';

jest.mock('../AirConditionerAPI.js');
jest.mock('../CacheManager.js');

// Explicitly type the mocked modules
const MockedAirConditionerAPI = AirConditionerAPI as jest.MockedClass<typeof AirConditionerAPI>;
const MockedCacheManager = CacheManager as jest.Mocked<typeof CacheManager>;

describe('SleepSwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: jest.Mocked<PlatformAccessory>;
  let service: jest.Mocked<Service>;
  let characteristic: jest.Mocked<Characteristic>;
  let mockCacheManager: jest.Mocked<CacheManager>;
  let inst: SleepSwitchAccessory;

  beforeEach(() => {
    jest.clearAllMocks();

    characteristic = {
      on: jest.fn().mockReturnThis(),
      updateValue: jest.fn(),
      setProps: jest.fn().mockReturnThis(),
    } as unknown as jest.Mocked<Characteristic>;

    service = {
      getCharacteristic: jest.fn().mockReturnValue(characteristic),
      setCharacteristic: jest.fn().mockReturnThis(),
      updateCharacteristic: jest.fn(),
    } as unknown as jest.Mocked<Service>;

    accessory = {
      getService: jest.fn().mockReturnValue(service),
      getServiceById: jest.fn().mockReturnValue(service),
      addService: jest.fn().mockReturnValue(service),
      context: {
        deviceConfig: {
          ip: '192.168.1.100',
          port: 8080,
          name: 'Test AC',
          updateInterval: 10,
        } as TfiacDeviceConfig,
      },
      displayName: 'Test AC Display Name',
    } as unknown as jest.Mocked<PlatformAccessory>;

    platform = {
      log: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
      api: {
        hap: {
          Service: {
            Switch: jest.fn().mockImplementation(() => service),
          },
          Characteristic: {
            On: jest.fn(),
            Name: jest.fn(),
          },
        },
      },
      Service: {
        Switch: jest.fn().mockImplementation(() => service),
      },
      Characteristic: {
        On: characteristic,
        Name: jest.fn(),
      },
    } as unknown as TfiacPlatform;

    // Adjust CacheManager mock definition and casting
    mockCacheManager = {
      getStatus: jest.fn(),
      clear: jest.fn(),
      cleanup: jest.fn(), // Added cleanup mock
      // Add other properties if needed by tests, or keep minimal
    } as unknown as jest.Mocked<CacheManager>; // Use 'as unknown as'
    MockedCacheManager.getInstance.mockReturnValue(mockCacheManager);

    inst = new SleepSwitchAccessory(platform, accessory);

    inst.stopPolling();
    (inst as any).pollingInterval = null;

    (service.setCharacteristic as jest.Mock).mockClear();
    (service.updateCharacteristic as jest.Mock).mockClear();
    (platform.log.debug as jest.Mock).mockClear();
    (characteristic.on as jest.Mock).mockClear();
    (accessory.getServiceById as jest.Mock).mockClear();
    (service.getCharacteristic as jest.Mock).mockClear();
    (mockCacheManager.getStatus as jest.Mock).mockClear();
    (mockCacheManager.clear as jest.Mock).mockClear();

    const deviceAPIMockInstance = MockedAirConditionerAPI.mock.instances[0] as jest.Mocked<AirConditionerAPI>;
    if (deviceAPIMockInstance) {
      (deviceAPIMockInstance.setSleepState as jest.Mock).mockClear();
    }
  });

  it('should initialize correctly', () => {
    (accessory.getServiceById as jest.Mock).mockClear();
    (service.setCharacteristic as jest.Mock).mockClear();
    (service.getCharacteristic as jest.Mock).mockClear();
    (characteristic.on as jest.Mock).mockClear();

    inst = new SleepSwitchAccessory(platform, accessory);

    expect(accessory.getServiceById).toHaveBeenCalledWith(platform.Service.Switch.UUID, 'sleep');
    expect(service.setCharacteristic).toHaveBeenCalledWith(platform.Characteristic.Name, 'Sleep');
    expect(service.getCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On);
    expect(characteristic.on).toHaveBeenCalledWith('get', expect.any(Function));
    expect(characteristic.on).toHaveBeenCalledWith('set', expect.any(Function));
  });

  describe('handleGet', () => {
    it('should return false when cachedStatus is null', (done) => {
      (inst as any).cachedStatus = null;
      (inst as any).handleGet((err: Error | null | undefined, value?: CharacteristicValue) => {
        expect(err).toBeNull();
        expect(value).toBe(false);
        done();
      });
    });

    it('should return true when opt_sleepMode starts with sleepMode', (done) => {
      (inst as any).cachedStatus = { opt_sleepMode: 'sleepMode1:active' };
      (inst as any).handleGet((err: Error | null | undefined, value?: CharacteristicValue) => {
        expect(err).toBeNull();
        expect(value).toBe(true);
        done();
      });
    });

    it('should return false when opt_sleepMode is off or different', (done) => {
      (inst as any).cachedStatus = { opt_sleepMode: 'off' };
      (inst as any).handleGet((err: Error | null | undefined, value?: CharacteristicValue) => {
        expect(err).toBeNull();
        expect(value).toBe(false);
      });

      (inst as any).cachedStatus = { opt_sleepMode: 'otherMode' };
      (inst as any).handleGet((err: Error | null | undefined, value?: CharacteristicValue) => {
        expect(err).toBeNull();
        expect(value).toBe(false);
        done();
      });
    });
  });

  describe('handleSet', () => {
    it('should call setSleepState with "on" when value is true', async () => {
      const deviceAPIMockInstance = MockedAirConditionerAPI.mock.instances[0] as jest.Mocked<AirConditionerAPI>;
      const callback = jest.fn();
      await (inst as any).handleSet(true, callback);
      expect(deviceAPIMockInstance.setSleepState).toHaveBeenCalledWith('on');
      expect(mockCacheManager.clear).toHaveBeenCalled();
      expect(service.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, true);
      expect(callback).toHaveBeenCalledWith(null);
    });

    it('should call setSleepState with "off" when value is false', async () => {
      const deviceAPIMockInstance = MockedAirConditionerAPI.mock.instances[0] as jest.Mocked<AirConditionerAPI>;
      const callback = jest.fn();
      await (inst as any).handleSet(false, callback);
      expect(deviceAPIMockInstance.setSleepState).toHaveBeenCalledWith('off');
      expect(mockCacheManager.clear).toHaveBeenCalled();
      expect(service.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, false);
      expect(callback).toHaveBeenCalledWith(null);
    });

    it('should handle errors from setSleepState', async () => {
      const deviceAPIMockInstance = MockedAirConditionerAPI.mock.instances[0] as jest.Mocked<AirConditionerAPI>;
      const callback = jest.fn();
      const error = new Error('API Error');
      deviceAPIMockInstance.setSleepState.mockRejectedValue(error);
      await (inst as any).handleSet(true, callback);
      expect(deviceAPIMockInstance.setSleepState).toHaveBeenCalledWith('on');
      expect(mockCacheManager.clear).not.toHaveBeenCalled();
      expect(service.updateCharacteristic).not.toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith(error);
      expect(platform.log.error).toHaveBeenCalledWith(expect.stringContaining('Error setting Sleep'), error);
    });
  });

  describe('updateCachedStatus', () => {
    it('updateCachedStatus updates characteristic when opt_sleepMode changes from off to on', async () => {
      (inst as any).cachedStatus = { opt_sleepMode: 'off' };
      mockCacheManager.getStatus.mockResolvedValueOnce({ opt_sleepMode: 'sleepMode2:active' } as any);
      await (inst as any).updateCachedStatus();
      expect(service.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, true);
      expect(service.updateCharacteristic).toHaveBeenCalledTimes(1);
    });

    it('updateCachedStatus updates characteristic when opt_sleepMode changes from on to off', async () => {
      (inst as any).cachedStatus = { opt_sleepMode: 'sleepMode1:active' };
      mockCacheManager.getStatus.mockResolvedValueOnce({ opt_sleepMode: 'off' } as any);
      await (inst as any).updateCachedStatus();
      expect(service.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, false);
      expect(service.updateCharacteristic).toHaveBeenCalledTimes(1);
    });

    it('updateCachedStatus does not update characteristic if opt_sleepMode unchanged (on)', async () => {
      (inst as any).cachedStatus = { opt_sleepMode: 'sleepMode1:active' };
      mockCacheManager.getStatus.mockResolvedValueOnce({ opt_sleepMode: 'sleepMode1:active' } as any);
      await (inst as any).updateCachedStatus();
      expect(service.updateCharacteristic).not.toHaveBeenCalled();
    });

    it('updateCachedStatus does not update characteristic if opt_sleepMode unchanged (off)', async () => {
      (inst as any).cachedStatus = { opt_sleepMode: 'off' };
      mockCacheManager.getStatus.mockResolvedValueOnce({ opt_sleepMode: 'off' } as any);
      await (inst as any).updateCachedStatus();
      expect(service.updateCharacteristic).not.toHaveBeenCalled();
    });

    it('updateCachedStatus handles error from getStatus', async () => {
      const error = new Error('fail');
      mockCacheManager.getStatus.mockRejectedValueOnce(error);
      await (inst as any).updateCachedStatus();
      expect(platform.log.error).toHaveBeenCalledWith(
        `Error updating Sleep status for ${accessory.displayName}:`,
        error,
      );
      expect(service.updateCharacteristic).not.toHaveBeenCalled();
    });
  });
});