import { vi, it, expect, describe, beforeEach, afterEach } from 'vitest';
import { SleepSwitchAccessory } from '../SleepSwitchAccessory.js';
import { PlatformAccessory, Service } from 'homebridge';
import { TfiacPlatform } from '../platform.js';
import { createMockApiActions, createMockCacheManager } from './testUtils';
import { SleepModeState, PowerState, FanSpeed } from '../enums.js';

// Create mock implementations
vi.mock('../CacheManager.js', () => ({
  CacheManager: {
    getInstance: vi.fn(),
  },
  default: {
    getInstance: vi.fn(),
  },
}));

describe('SleepSwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: any;
  let mockService: any;
  let inst: SleepSwitchAccessory;
  let mockApiActions: any;
  let mockCacheManager: any;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Create platform mock
    platform = {
      log: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      config: {
        debug: false, // Add this configuration property
      },
      api: {
        hap: {
          Service: {
            Switch: { UUID: 'switch-uuid' },
          },
          Characteristic: {
            On: 'On',
            Name: 'Name',
          },
        },
      },
      Service: {
        Switch: { UUID: 'switch-uuid' },
      },
      Characteristic: {
        On: 'On',
        Name: 'Name',
        ConfiguredName: 'ConfiguredName',
      },
    } as any;

    // Create mock service
    mockService = {
      setCharacteristic: vi.fn().mockReturnThis(),
      getCharacteristic: vi.fn().mockReturnValue({
        on: vi.fn(),
        onGet: vi.fn(),
        onSet: vi.fn(),
      }),
      updateCharacteristic: vi.fn(),
    };

    // Create mock accessory
    accessory = {
      getService: vi.fn().mockReturnValue(null), // Return null to force addService call
      getServiceById: vi.fn().mockReturnValue(null), // Return null to force addService call
      addService: vi.fn().mockReturnValue(mockService),
      context: {
        deviceConfig: {
          ip: '192.168.1.100',
          port: 8080,
          name: 'Test AC',
        },
      },
      displayName: 'Test AC',
      services: [mockService],
    };

    // Create API mock with sleep methods
    mockApiActions = createMockApiActions({ opt_sleep: 'on' });
    mockApiActions.setSleepState = vi.fn().mockResolvedValue(undefined);
    mockApiActions.setFanAndSleepState = vi.fn().mockResolvedValue(undefined);
    mockApiActions.setTurboState = vi.fn().mockResolvedValue(undefined);
    mockApiActions.setTurboAndSleep = vi.fn().mockResolvedValue(undefined);
    
    // Create mock CacheManager
    mockCacheManager = createMockCacheManager(mockApiActions, { opt_sleep: 'on' });

    // No listener capture; tests will call updateStatus directly
  });

  function createAccessory() {
    inst = new SleepSwitchAccessory(platform, accessory);
    // Override CacheManager to use our mock
    (inst as any).cacheManager = mockCacheManager;
    return inst;
  }

  it('should initialize correctly', () => {
    createAccessory();
    expect(accessory.addService).toHaveBeenCalledWith(
      platform.Service.Switch,
      'Sleep',
      'sleep'
    );
    expect(mockService.setCharacteristic).toHaveBeenCalledWith(platform.Characteristic.Name, 'Sleep');
    expect(mockService.getCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On);
    // No subscription test here
  });

  it('handles get characteristic with sleep on', () => {
    createAccessory();
    const callback = vi.fn();
    // Sleep is on AND AC is on
    inst.updateStatus({ opt_sleep: 'on', is_on: 'on' } as any);
    
    (inst as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it('handles get characteristic with sleep on but AC off', () => {
    createAccessory();
    const callback = vi.fn();
    // Sleep is on but AC is off
    inst.updateStatus({ opt_sleep: 'on', is_on: 'off' } as any);
    
    (inst as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it('handles get characteristic with sleep off', () => {
    createAccessory();
    const callback = vi.fn();
    inst.updateStatus({ opt_sleep: 'off', is_on: 'on' } as any);
    
    (inst as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it('handles get characteristic with null status', () => {
    createAccessory();
    const callback = vi.fn();
    // Don't set status to test null case
    (inst as any).cachedStatus = null;
    
    (inst as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it('handles set characteristic to turn sleep on', async () => {
    createAccessory();
    const callback = vi.fn();
    
    // Make sure the mock API methods are defined properly
    mockApiActions.setTurboAndSleep = vi.fn().mockResolvedValue(undefined);
    mockApiActions.updateState = vi.fn().mockResolvedValue({ 
      opt_turbo: 'off',
      is_on: PowerState.On 
    });
    mockCacheManager.api = mockApiActions;
    (inst as any).cacheManager = mockCacheManager;
    
    await (inst as any).handleSet(true, callback);
    
    // Check that setTurboAndSleep was called instead of setFanAndSleepState
    expect(mockApiActions.setTurboAndSleep).toHaveBeenCalledWith(FanSpeed.Low, SleepModeState.On);
    // Don't expect clear() to be called
    expect(mockCacheManager.clear).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(null);
  });

  it('handles set characteristic trying to turn sleep on when AC is off', async () => {
    createAccessory();
    const callback = vi.fn();
    // Mock service to check updateCharacteristic
    const mockUpdateCharacteristic = vi.fn();
    (inst as any).service = {
      updateCharacteristic: mockUpdateCharacteristic
    };
    
    // Mock a device status with AC off
    mockApiActions.updateState = vi.fn().mockResolvedValue({ 
      opt_turbo: 'off',
      is_on: PowerState.Off 
    });
    
    await (inst as any).handleSet(true, callback);
    
    // Verify that setTurboAndSleep was NOT called because AC is off
    expect(mockApiActions.setTurboAndSleep).not.toHaveBeenCalled();
    // Verify that service was updated to show actual state (false)
    expect(mockUpdateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, false);
    // Verify callback was still called
    expect(callback).toHaveBeenCalledWith(null);
  });

  it('handles set characteristic to turn sleep on when turbo is active', async () => {
    createAccessory();
    const callback = vi.fn();
    
    // Mock the API object with all required methods
    const mockUpdateState = vi.fn().mockResolvedValue({ 
      opt_turbo: PowerState.On,
      is_on: PowerState.On 
    });
    
    // Use setTurboAndSleep instead of separate calls based on the implementation
    const mockSetTurboAndSleep = vi.fn().mockResolvedValue(undefined);
    
    // Properly attach our mocks to the API object
    mockApiActions.updateState = mockUpdateState;
    mockApiActions.setTurboAndSleep = mockSetTurboAndSleep;
    
    // Make sure our mocks are attached to the cacheManager
    mockCacheManager.api = mockApiActions;
    
    // Ensure our accessory has these mocks
    (inst as any).cacheManager = mockCacheManager;
    
    // Call the handleSet method directly (which simulates turning sleep ON)
    await (inst as any).handleSet(true, callback);
    
    // Verify our updateState mock was called
    expect(mockUpdateState).toHaveBeenCalled();
    
    // Check that setTurboAndSleep was called with correct params
    expect(mockSetTurboAndSleep).toHaveBeenCalledWith(FanSpeed.Low, SleepModeState.On);
    expect(callback).toHaveBeenCalledWith(null);
  });

  it('handles set characteristic to turn sleep off', async () => {
    createAccessory();
    const callback = vi.fn();
    await (inst as any).handleSet(false, callback);
    expect(mockApiActions.setSleepState).toHaveBeenCalledWith(SleepModeState.Off);
    // Don't expect clear() to be called
    expect(mockCacheManager.clear).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(null);
  });

  it('handles set error', async () => {
    createAccessory();
    const callback = vi.fn();
    const error = new Error('Network error');
    
    // Ensure our mocks are properly defined
    mockApiActions.setTurboAndSleep = vi.fn().mockRejectedValueOnce(error);
    mockApiActions.updateState = vi.fn().mockResolvedValue({ 
      opt_turbo: 'off',
      is_on: PowerState.On
    });
    mockCacheManager.api = mockApiActions;
    (inst as any).cacheManager = mockCacheManager;
    
    await (inst as any).handleSet(true, callback);
    
    expect(mockApiActions.setTurboAndSleep).toHaveBeenCalledWith(FanSpeed.Low, SleepModeState.On);
    expect(callback).toHaveBeenCalledWith(error);
    expect(platform.log.error).toHaveBeenCalledWith(
      expect.stringContaining('Error setting Sleep'),
      error
    );
  });

  describe('Status Listener', () => {
    it('updates characteristic when sleep state changes from off to on', () => {
      createAccessory();
      // AC is on for both cases
      inst.updateStatus({ opt_sleep: 'off', is_on: 'on' } as any);
      mockService.updateCharacteristic.mockClear();
      
      inst.updateStatus({ opt_sleep: 'on', is_on: 'on' } as any);
      
      expect(mockService.updateCharacteristic).toHaveBeenCalledWith('On', true);
    });

    it('updates characteristic when sleep state changes from on to off', () => {
      createAccessory();
      // AC is on for both cases
      inst.updateStatus({ opt_sleep: 'on', is_on: 'on' } as any);
      mockService.updateCharacteristic.mockClear();
      
      inst.updateStatus({ opt_sleep: 'off', is_on: 'on' } as any);
      
      expect(mockService.updateCharacteristic).toHaveBeenCalledWith('On', false);
    });

    it('does not update characteristic if sleep state unchanged (on)', () => {
      createAccessory();
      inst.updateStatus({ opt_sleep: 'on' } as any);
      mockService.updateCharacteristic.mockClear();
      
      inst.updateStatus({ opt_sleep: 'on' } as any);
      
      expect(mockService.updateCharacteristic).not.toHaveBeenCalled();
    });

    it('does not update characteristic if sleep state unchanged (off)', () => {
      createAccessory();
      inst.updateStatus({ opt_sleep: 'off' } as any);
      mockService.updateCharacteristic.mockClear();
      
      inst.updateStatus({ opt_sleep: 'off' } as any);
      
      expect(mockService.updateCharacteristic).not.toHaveBeenCalled();
    });

    it('handles null status gracefully', () => {
      createAccessory();
      inst.updateStatus(null);
      expect(true).toBe(true);
    });
  });

  it('stops polling and cleans up api', () => {
    createAccessory();
    inst.stopPolling();
    expect(mockCacheManager.cleanup).toHaveBeenCalled();
  });
});