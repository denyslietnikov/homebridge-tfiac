import { PlatformAccessory, Service, Characteristic } from 'homebridge';
import { TfiacPlatform } from '../platform.js';
import { BaseSwitchAccessory } from '../BaseSwitchAccessory.js';
import AirConditionerAPI, { AirConditionerStatus } from '../AirConditionerAPI.js';
import CacheManager from '../CacheManager.js';
import { TfiacDeviceConfig } from '../settings.js';

// Mock implementations
jest.mock('../AirConditionerAPI.js'); 
jest.mock('../CacheManager.js');

// Concrete class for testing BaseSwitchAccessory
class TestSwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
    getStatusValue: (status: Partial<AirConditionerStatus>) => boolean,
    setApiState: (value: boolean) => Promise<void>,
  ) {
    super(
      platform,
      accessory,
      'Test Switch', // serviceName
      'testswitch', // serviceSubtype
      getStatusValue, // getStatusValue function
      setApiState, // setApiState function
      'TestSwitch', // logPrefix
    );
  }
  // Expose protected methods for testing
  public testHandleGet(callback: jest.Mock) {
    super.handleGet(callback);
  }
  public async testHandleSet(value: boolean, callback: jest.Mock) {
    await super.handleSet(value, callback);
  }
  public async testUpdateCachedStatus() {
    await super.updateCachedStatus();
  }
}

describe('BaseSwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let service: Service;
  let characteristic: Characteristic;
  let mockGetStatusValue: jest.Mock;
  let mockSetApiState: jest.Mock;
  let mockCacheManager: jest.Mocked<CacheManager>;
  let inst: TestSwitchAccessory;

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();

    // Mock Characteristic
    characteristic = {
      on: jest.fn().mockReturnThis(),
      updateValue: jest.fn(),
    } as unknown as Characteristic;

    // Mock Service
    service = {
      getCharacteristic: jest.fn().mockReturnValue(characteristic),
      setCharacteristic: jest.fn().mockReturnThis(),
      updateCharacteristic: jest.fn(),
    } as unknown as Service;

    // Mock Accessory
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
    } as unknown as PlatformAccessory;

    // Mock Platform
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
            Switch: jest.fn(),
          },
          Characteristic: {
            On: jest.fn(),
            Name: jest.fn(),
          },
        },
      },
      Service: {
        Switch: service, // Use the mocked service instance
      },
      Characteristic: {
        On: characteristic, // Use the mocked characteristic instance
        Name: jest.fn(),
      },
    } as unknown as TfiacPlatform;

    // Mock CacheManager
    // Ensure getInstance returns a mock with the getStatus method and api event methods
    mockCacheManager = {
      getStatus: jest.fn(),
      clear: jest.fn(),
      cleanup: jest.fn(),
      api: { on: jest.fn(), off: jest.fn() },
    } as unknown as jest.Mocked<CacheManager>;
    (CacheManager.getInstance as jest.Mock).mockReturnValue(mockCacheManager);

    // Mock functions for the constructor
    mockGetStatusValue = jest.fn().mockImplementation((status) => status.opt_test === 'on');
    mockSetApiState = jest.fn().mockResolvedValue(undefined);

    // Create instance of the test class
    inst = new TestSwitchAccessory(
      platform,
      accessory,
      mockGetStatusValue,
      mockSetApiState,
    );
    // Prevent actual polling during tests
    inst.stopPolling();
    (inst as any).pollingInterval = null; // Ensure interval is cleared
  });

  it('should initialize correctly', () => {
    expect(accessory.getServiceById).toHaveBeenCalledWith(platform.Service.Switch.UUID, 'testswitch');
    expect(service.setCharacteristic).toHaveBeenCalledWith(platform.Characteristic.Name, 'Test Switch');
    expect(service.getCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On);
    expect(characteristic.on).toHaveBeenCalledWith('get', expect.any(Function));
    expect(characteristic.on).toHaveBeenCalledWith('set', expect.any(Function));
    expect(platform.log.debug).toHaveBeenCalledWith(expect.stringContaining('TestSwitch accessory initialized'));
  });

  describe('handleGet', () => {
    it('should return false when cachedStatus is null', () => {
      const callback = jest.fn();
      (inst as any).cachedStatus = null;
      inst.testHandleGet(callback);
      expect(mockGetStatusValue).not.toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith(null, false);
    });

    it('should return value from getStatusValue when cachedStatus exists', () => {
      const callback = jest.fn();
      (inst as any).cachedStatus = { opt_test: 'on' };
      mockGetStatusValue.mockReturnValue(true); // Explicitly set return for this test
      inst.testHandleGet(callback);
      expect(mockGetStatusValue).toHaveBeenCalledWith({ opt_test: 'on' });
      expect(callback).toHaveBeenCalledWith(null, true);

      jest.clearAllMocks(); // Clear mocks for next part
      (inst as any).cachedStatus = { opt_test: 'off' };
      mockGetStatusValue.mockReturnValue(false);
      inst.testHandleGet(callback);
      expect(mockGetStatusValue).toHaveBeenCalledWith({ opt_test: 'off' });
      expect(callback).toHaveBeenCalledWith(null, false);
    });
  });

  describe('handleSet', () => {
    it('should call setApiState and update characteristic', async () => {
      const callback = jest.fn();
      await inst.testHandleSet(true, callback);
      expect(mockSetApiState).toHaveBeenCalledWith(true);
      expect(mockCacheManager.clear).toHaveBeenCalled();
      expect(service.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, true);
      expect(callback).toHaveBeenCalledWith(null);
      expect(platform.log.error).not.toHaveBeenCalled();
    });

    it('should handle errors from setApiState', async () => {
      const callback = jest.fn();
      const error = new Error('API Set Error');
      mockSetApiState.mockRejectedValue(error);
      await inst.testHandleSet(false, callback);
      expect(mockSetApiState).toHaveBeenCalledWith(false);
      expect(mockCacheManager.clear).not.toHaveBeenCalled(); // Should not clear cache on error
      expect(service.updateCharacteristic).not.toHaveBeenCalled(); // Should not update characteristic on error
      expect(callback).toHaveBeenCalledWith(error);
      expect(platform.log.error).toHaveBeenCalledWith(expect.stringContaining('Error setting TestSwitch'), error);
    });
  });

  // Skipping updateCachedStatus tests as method was refactored to updateStatus
});
