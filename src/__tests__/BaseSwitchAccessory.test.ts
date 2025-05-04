import { vi, it, expect, describe, beforeEach, afterEach } from 'vitest';
import { PlatformAccessory, Service, Characteristic } from 'homebridge';
import { TfiacDeviceConfig } from '../settings.js';
import { AirConditionerStatus } from '../AirConditionerAPI.js';

// Mock implementations before imports to avoid hoisting issues
vi.mock('../AirConditionerAPI.js', () => {
  return {
    AirConditionerAPI: vi.fn(),
  };
}); 

vi.mock('../CacheManager.js', () => {
  return {
    CacheManager: {
      getInstance: vi.fn(),
    }
  };
});

// Import after mocks
import { TfiacPlatform } from '../platform.js';
import { BaseSwitchAccessory } from '../BaseSwitchAccessory.js';
import { CacheManager } from '../CacheManager.js';

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
  public testHandleGet(callback: ReturnType<typeof vi.fn>) {
    return super.handleGet(callback);
  }
  public async testHandleSet(value: boolean, callback: ReturnType<typeof vi.fn>) {
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
  let mockGetStatusValue: ReturnType<typeof vi.fn>;
  let mockSetApiState: ReturnType<typeof vi.fn>;
  let mockCacheManager: any;
  let inst: TestSwitchAccessory;

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();

    // Mock Characteristic
    characteristic = {
      on: vi.fn().mockReturnThis(),
      updateValue: vi.fn(),
    } as unknown as Characteristic;

    // Mock Service
    service = {
      getCharacteristic: vi.fn().mockReturnValue(characteristic),
      setCharacteristic: vi.fn().mockReturnThis(),
      updateCharacteristic: vi.fn(),
    } as unknown as Service;

    // Mock Accessory
    accessory = {
      getService: vi.fn().mockReturnValue(service),
      getServiceById: vi.fn().mockReturnValue(service),
      addService: vi.fn().mockReturnValue(service),
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
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      api: {
        hap: {
          Service: {
            Switch: vi.fn(),
          },
          Characteristic: {
            On: vi.fn(),
            Name: vi.fn(),
          },
        },
      },
      Service: {
        Switch: service, // Use the mocked service instance
      },
      Characteristic: {
        On: characteristic, // Use the mocked characteristic instance
        Name: vi.fn(),
      },
    } as unknown as TfiacPlatform;

    // Mock CacheManager
    // Ensure getInstance returns a mock with the getStatus method and api event methods
    mockCacheManager = {
      getStatus: vi.fn(),
      clear: vi.fn(),
      cleanup: vi.fn(),
      api: { on: vi.fn(), off: vi.fn() },
    };
    
    (CacheManager.getInstance as ReturnType<typeof vi.fn>).mockReturnValue(mockCacheManager);

    // Mock functions for the constructor
    mockGetStatusValue = vi.fn().mockImplementation((status) => status.opt_test === 'on');
    mockSetApiState = vi.fn().mockResolvedValue(undefined);

    // Create instance of the test class
    inst = new TestSwitchAccessory(
      platform,
      accessory,
      mockGetStatusValue as (status: Partial<AirConditionerStatus>) => boolean,
      mockSetApiState as (value: boolean) => Promise<void>,
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
    it('should return false when cachedStatus is null', async () => {
      (inst as any).cachedStatus = null;
      const callback = vi.fn();
      await inst.testHandleGet(callback);
      expect(mockGetStatusValue).not.toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith(null, false);
    });

    it('should return value from getStatusValue when cachedStatus exists', async () => {
      (inst as any).cachedStatus = { opt_test: 'on' };
      mockGetStatusValue.mockReturnValue(true);
      const callback = vi.fn();
      await inst.testHandleGet(callback);
      expect(mockGetStatusValue).toHaveBeenCalledWith({ opt_test: 'on' });
      expect(callback).toHaveBeenCalledWith(null, true);

      vi.clearAllMocks();
      (inst as any).cachedStatus = { opt_test: 'off' };
      mockGetStatusValue.mockReturnValue(false);
      const callback2 = vi.fn();
      await inst.testHandleGet(callback2);
      expect(mockGetStatusValue).toHaveBeenCalledWith({ opt_test: 'off' });
      expect(callback2).toHaveBeenCalledWith(null, false);
    });
  });

  describe('handleSet', () => {
    it('should call setApiState and update characteristic', async () => {
      const callback = vi.fn();
      await inst.testHandleSet(true, callback);
      expect(mockSetApiState).toHaveBeenCalledWith(true);
      expect(mockCacheManager.clear).toHaveBeenCalled();
      expect(service.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, true);
      expect(callback).toHaveBeenCalledWith(null);
      expect(platform.log.error).not.toHaveBeenCalled();
    });

    it('should handle errors from setApiState', async () => {
      const callback = vi.fn();
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

  // Tests for updateCachedStatus method
  describe('updateCachedStatus', () => {
    it('should update cachedStatus from CacheManager', async () => {
      mockCacheManager.getStatus.mockResolvedValue({ opt_test: 'on', other_prop: 'value' });
      await inst.testUpdateCachedStatus();
      expect(mockCacheManager.getStatus).toHaveBeenCalled();
      expect((inst as any).cachedStatus).toEqual({ opt_test: 'on', other_prop: 'value' });
    });

    it('should handle errors during status update', async () => {
      const error = new Error('Failed to get status');
      mockCacheManager.getStatus.mockRejectedValue(error);
      await inst.testUpdateCachedStatus();
      expect(platform.log.error).toHaveBeenCalledWith(
        expect.stringContaining('Error updating TestSwitch status'),
        error
      );
      expect((inst as any).cachedStatus).toBeNull();
    });
  });
});
