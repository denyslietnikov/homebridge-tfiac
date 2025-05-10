import { vi, it, expect, describe, beforeEach, afterEach } from 'vitest';
import { PlatformAccessory, Service, Characteristic, CharacteristicValue, CharacteristicSetCallback } from 'homebridge';
import { TfiacDeviceConfig } from '../settings.js';
import { AirConditionerStatus } from '../AirConditionerAPI.js';
import { createMockCacheManager } from './testUtils';

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

// Define the TestSwitchAccessory class for testing
class TestSwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
    getStatusValueFn?: (status: Partial<AirConditionerStatus>) => boolean,
    setApiStateFn?: (value: boolean) => Promise<void>
  ) {
    const getStatusValue = getStatusValueFn || ((status: Partial<AirConditionerStatus>) => {
      // Using a type assertion because this is just a test helper
      return (status as any).opt_test === 'on';
    });
    const setApiState = setApiStateFn || (async (value: boolean) => {
      // Default empty implementation
    });

    super(
      platform,
      accessory,
      'Test Switch',
      'testswitch',
      getStatusValue,
      setApiState,
      'Test Switch' // Need to explicitly set the logPrefix
    );

    // Override the CacheManager with our mock version
    this.cacheManager = {
      getStatus: vi.fn().mockResolvedValue(null),
      getLastStatus: vi.fn().mockReturnValue(null),
      clear: vi.fn(),
      cleanup: vi.fn(),
      api: { 
        on: vi.fn(), 
        off: vi.fn(),
        emit: vi.fn(),
        // Other required properties for the AirConditionerAPI
        ip: '192.168.1.100',
        port: 8080,
        available: true,
        lastSeq: 0,
        setTurboState: vi.fn(),
        setBeepState: vi.fn(),
        setDisplayState: vi.fn(),
        setAirConditionerState: vi.fn(),
        turnOn: vi.fn(),
        turnOff: vi.fn(),
        updateState: vi.fn(),
        setSwingMode: vi.fn(),
        setFanSpeed: vi.fn(),
        setSleepState: vi.fn(),
        setEcoState: vi.fn(),
        cleanup: vi.fn()
      } as any
    } as unknown as CacheManager;
  }

  public handleGet(callback?: (error: Error | null, value?: boolean) => void): boolean {
    return super.handleGet(callback);
  }

  public async handleSet(value: CharacteristicValue, callback?: CharacteristicSetCallback): Promise<void> {
    await super.handleSet(value, callback as any);
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
  let statusListener: Function;

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
        Switch: {
          UUID: 'switch-uuid',
        },
      },
      Characteristic: {
        On: 'On',
        Name: 'Name',
      },
    } as unknown as TfiacPlatform;

    // Mock CacheManager
    // Ensure getInstance returns a mock with the getStatus method and api event methods
    mockCacheManager = {
      getStatus: vi.fn().mockResolvedValue(null),
      getLastStatus: vi.fn().mockReturnValue(null),
      clear: vi.fn(),
      cleanup: vi.fn(),
      api: { 
        on: vi.fn().mockImplementation((event, listener) => {
          if (event === 'status') {
            statusListener = listener;
          }
        }), 
        off: vi.fn(),
        emit: vi.fn()
      }
    };
    
    (CacheManager.getInstance as ReturnType<typeof vi.fn>).mockReturnValue(mockCacheManager);

    // Mock functions for the constructor
    mockGetStatusValue = vi.fn().mockImplementation((status) => status.opt_test === 'on');
    mockSetApiState = vi.fn().mockResolvedValue(undefined);

    // Create instance of the test class
    inst = new TestSwitchAccessory(
      platform,
      accessory,
      mockGetStatusValue,
      mockSetApiState
    );
    
    // Replace the cacheManager with our mock
    (inst as any).cacheManager = mockCacheManager;
  });

  it('should initialize correctly', () => {
    expect(accessory.getServiceById).toHaveBeenCalledWith(platform.Service.Switch.UUID, 'testswitch');
    expect(service.setCharacteristic).toHaveBeenCalledWith(platform.Characteristic.Name, 'Test Switch');
    expect(service.getCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On);
    expect(characteristic.on).toHaveBeenCalledWith('get', expect.any(Function));
    expect(characteristic.on).toHaveBeenCalledWith('set', expect.any(Function));
    // Verify event listener is registered
    expect(mockCacheManager.api.on).toHaveBeenCalledWith('status', expect.any(Function));
    // Update to match the actual log message format
    expect(platform.log.debug).toHaveBeenCalledWith(
      expect.stringContaining('Test Switch accessory initialized for Test AC Display Name')
    );
  });

  it('should stop polling and cleanup', () => {
    inst.stopPolling();
    expect(mockCacheManager.cleanup).toHaveBeenCalled();
    // Verify event listener is removed
    expect(mockCacheManager.api.off).toHaveBeenCalledWith('status', expect.any(Function));

    // Clear mock calls
    (service.updateCharacteristic as any).mockClear();
  });

  describe('handleGet', () => {
    it('should return false when cachedStatus is null', async () => {
      // Don't set any status via listener to test null case
      (inst as any).cachedStatus = null;
      const callback = vi.fn();
      await inst.handleGet(callback);
      expect(mockGetStatusValue).not.toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith(null, false);
    });

    it('should return value from getStatusValue when cachedStatus exists', async () => {
      // Update via status listener
      const status = { opt_test: 'on' };
      statusListener(status);
      
      // Make sure the mock function returns the expected value
      mockGetStatusValue.mockReturnValue(true);
      
      const callback = vi.fn();
      inst.handleGet(callback);
      
      expect(mockGetStatusValue).toHaveBeenCalledWith(status);
      expect(callback).toHaveBeenCalledWith(null, true);

      // Test the opposite case
      vi.clearAllMocks();
      mockGetStatusValue.mockReturnValue(false);
      const status2 = { opt_test: 'off' };
      statusListener(status2);
      
      const callback2 = vi.fn();
      inst.handleGet(callback2);
      expect(mockGetStatusValue).toHaveBeenCalledWith(status2);
      expect(callback2).toHaveBeenCalledWith(null, false);
    });
  });

  describe('handleSet', () => {
    it('should call setApiState and not clear cache manually', async () => {
      const callback = vi.fn();
      await inst.handleSet(true, callback);
      expect(mockSetApiState).toHaveBeenCalledWith(true);
      // The test should not expect clear() to be called - centralized status updates handle this now
      expect(mockCacheManager.clear).not.toHaveBeenCalled();
      // We now optimistically update the characteristic in handleSet for better UI responsiveness
      expect(service.updateCharacteristic).toHaveBeenCalledWith('On', true);
      expect(callback).toHaveBeenCalledWith(null);
      expect(platform.log.error).not.toHaveBeenCalled();
    });

    it('should handle errors from setApiState', async () => {
      const callback = vi.fn();
      const error = new Error('API Set Error');
      mockSetApiState.mockRejectedValue(error);
      await inst.handleSet(false, callback);
      expect(mockSetApiState).toHaveBeenCalledWith(false);
      expect(mockCacheManager.clear).not.toHaveBeenCalled(); // Should not clear cache on error
      expect(service.updateCharacteristic).not.toHaveBeenCalled(); // No update on error
      expect(callback).toHaveBeenCalledWith(error);
      // Update to match the actual log message format
      expect(platform.log.error).toHaveBeenCalledWith(
        expect.stringContaining('Error setting Test Switch'),
        error
      );
    });
  });

  describe('Status Listener', () => {
    it('should update characteristic when status changes to ON', () => {
      // Start with off state
      statusListener({ opt_test: 'off' });
      // Clear mock calls
      (service.updateCharacteristic as any).mockClear();
      
      // Now update to on
      statusListener({ opt_test: 'on' });
      
      expect(mockGetStatusValue).toHaveBeenCalledWith({ opt_test: 'on' });
      expect(service.updateCharacteristic).toHaveBeenCalledWith('On', true);
    });
    
    it('should update characteristic when status changes to OFF', () => {
      // Start with on state
      statusListener({ opt_test: 'on' });
      // Clear mock calls
      (service.updateCharacteristic as any).mockClear();
      
      // Now update to off
      statusListener({ opt_test: 'off' });
      
      expect(mockGetStatusValue).toHaveBeenCalledWith({ opt_test: 'off' });
      expect(service.updateCharacteristic).toHaveBeenCalledWith('On', false);
    });
    
    it('should not update characteristic if status value has not changed', () => {
      // Start with on state
      statusListener({ opt_test: 'on' });
      // Clear mock calls
      (service.updateCharacteristic as any).mockClear();
      
      // Update with same value
      statusListener({ opt_test: 'on' });
      
      expect(mockGetStatusValue).toHaveBeenCalledWith({ opt_test: 'on' });
      expect(service.updateCharacteristic).not.toHaveBeenCalled();
    });
    
    it('should handle null status gracefully', () => {
      // Simulate receiving null status
      statusListener(null);
      
      // Should not crash
      expect((service.updateCharacteristic as any)).not.toHaveBeenCalled();
    });
  });
});
