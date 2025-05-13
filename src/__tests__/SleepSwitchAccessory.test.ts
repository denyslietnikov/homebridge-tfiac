// filepath: /Users/denisletnikov/Code/homebridge-tfiac/src/__tests__/SleepSwitchAccessory.test.ts
import { vi, it, expect, describe, beforeEach, afterEach } from 'vitest';
import { SleepSwitchAccessory } from '../SleepSwitchAccessory.js';
import { PlatformAccessory, Service, CharacteristicValue, CharacteristicSetCallback } from 'homebridge';
import { TfiacPlatform } from '../platform.js';
import { createMockCacheManager, createMockDeviceState, createMockPlatform, defaultDeviceOptions } from './testUtils';
import { PowerState, SleepModeState } from '../enums.js';
import { AirConditionerStatus } from '../AirConditionerAPI.js';
import { CacheManager } from '../CacheManager.js';
import { DeviceState } from '../state/DeviceState.js';

vi.mock('../CacheManager.js', () => ({
  CacheManager: {
    getInstance: vi.fn(),
  },
}));

describe('SleepSwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: any;
  let mockService: any;
  let mockCharacteristicOn: any;
  let inst: SleepSwitchAccessory;
  let mockCacheManager: any;
  let mockDeviceStateObject: any;
  let capturedStateChangeListener: (state: DeviceState) => void;
  let capturedOnSetHandler: (value: CharacteristicValue, callback: CharacteristicSetCallback) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();

    platform = createMockPlatform();

    mockCharacteristicOn = {
      onGet: vi.fn().mockReturnThis(),
      onSet: vi.fn((handler) => {
        capturedOnSetHandler = handler;
        return mockCharacteristicOn;
      }),
      updateValue: vi.fn(),
    };

    mockService = {
      setCharacteristic: vi.fn().mockReturnThis(),
      getCharacteristic: vi.fn((char) => {
        if (char === platform.Characteristic.On) {
          return mockCharacteristicOn;
        }
        return { onGet: vi.fn().mockReturnThis(), onSet: vi.fn().mockReturnThis(), updateValue: vi.fn() };
      }),
      updateCharacteristic: vi.fn(),
    };

    accessory = {
      getService: vi.fn().mockReturnValue(null),
      getServiceById: vi.fn().mockReturnValue(mockService),
      addService: vi.fn().mockReturnValue(mockService),
      context: {
        deviceConfig: { ip: '192.168.1.100', port: 8080, name: 'Test AC Sleep' },
      },
      displayName: 'Test AC Sleep Display',
    };

    mockDeviceStateObject = createMockDeviceState(defaultDeviceOptions);
    mockDeviceStateObject.on = vi.fn((event, listener) => {
      if (event === 'stateChanged') {
        capturedStateChangeListener = listener;
      }
      return mockDeviceStateObject;
    });
    mockDeviceStateObject.setSleepMode = vi.fn();
    mockDeviceStateObject.clone = vi.fn().mockReturnValue(mockDeviceStateObject);

    mockCacheManager = createMockCacheManager();
    mockCacheManager.getDeviceState.mockReturnValue(mockDeviceStateObject);
    mockCacheManager.applyStateToDevice = vi.fn().mockResolvedValue(undefined);

    (CacheManager.getInstance as ReturnType<typeof vi.fn>).mockReturnValue(mockCacheManager);

    mockDeviceStateObject.toApiStatus.mockReturnValue({ 
      opt_sleepMode: SleepModeState.Off, 
      is_on: PowerState.Off, 
      opt_sleep: PowerState.Off 
    });

    inst = new SleepSwitchAccessory(platform, accessory);
  });

  it('should construct and set up characteristics and listeners', () => {
    expect(accessory.getServiceById).toHaveBeenCalledWith(platform.Service.Switch.UUID, 'sleep');
    expect(mockService.setCharacteristic).toHaveBeenCalledWith(platform.Characteristic.Name, 'Sleep');
    expect(mockService.getCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On);
    expect(mockCharacteristicOn.onGet).toHaveBeenCalledWith(expect.any(Function));
    expect(mockCharacteristicOn.onSet).toHaveBeenCalledWith(expect.any(Function));
    expect(mockDeviceStateObject.on).toHaveBeenCalledWith('stateChanged', expect.any(Function));
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, false);
  });

  it('should stop polling by removing DeviceState listener', () => {
    inst.stopPolling();
    expect(mockDeviceStateObject.removeListener).toHaveBeenCalledWith('stateChanged', expect.any(Function));
  });

  describe('handleGet (inherited from BaseSwitchAccessory)', () => {
    it('should return true when sleepMode is ON in cachedStatus', () => {
      inst.cachedStatus = { 
        opt_sleepMode: SleepModeState.On, 
        is_on: PowerState.On, 
        opt_turbo: PowerState.Off,
        opt_sleep: PowerState.On
      };
      const result = (inst as any).handleGet();
      expect(result).toBe(true);
    });

    it('should return false when sleepMode is OFF in cachedStatus', () => {
      inst.cachedStatus = { 
        opt_sleepMode: SleepModeState.Off, 
        is_on: PowerState.On, 
        opt_turbo: PowerState.Off,
        opt_sleep: PowerState.Off
      };
      const result = (inst as any).handleGet();
      expect(result).toBe(false);
    });

    it('should return false when AC is OFF', () => {
      inst.cachedStatus = { 
        opt_sleepMode: SleepModeState.On, 
        is_on: PowerState.Off, 
        opt_turbo: PowerState.Off,
        opt_sleep: PowerState.On
      };
      const result = (inst as any).handleGet();
      expect(result).toBe(false);
    });

    it('should return false when turbo is ON', () => {
      inst.cachedStatus = { 
        opt_sleepMode: SleepModeState.On, 
        is_on: PowerState.On, 
        opt_turbo: PowerState.On,
        opt_sleep: PowerState.On
      };
      const result = (inst as any).handleGet();
      expect(result).toBe(false);
    });
  });

  describe('handleSet (inherited from BaseSwitchAccessory)', () => {
    it('should call setSleepMode with ON when value is true', async () => {
      const mockCallback = vi.fn();
      mockDeviceStateObject.toApiStatus.mockReturnValue({ is_on: PowerState.On });
      mockDeviceStateObject.power = PowerState.On;
      
      await capturedOnSetHandler(true, mockCallback);
      
      expect(mockDeviceStateObject.setSleepMode).toHaveBeenCalledWith(SleepModeState.On);
      expect(mockCacheManager.applyStateToDevice).toHaveBeenCalledWith(mockDeviceStateObject);
      expect(mockCallback).toHaveBeenCalledWith(null);
    });

    it('should call setSleepMode with OFF when value is false', async () => {
      const mockCallback = vi.fn();
      await capturedOnSetHandler(false, mockCallback);
      
      expect(mockDeviceStateObject.setSleepMode).toHaveBeenCalledWith(SleepModeState.Off);
      expect(mockCacheManager.applyStateToDevice).toHaveBeenCalledWith(mockDeviceStateObject);
      expect(mockCallback).toHaveBeenCalledWith(null);
    });

    it('should not enable Sleep mode when AC is OFF and log a message', async () => {
      const mockCallback = vi.fn();
      mockDeviceStateObject.toApiStatus.mockReturnValue({ is_on: PowerState.Off });
      mockDeviceStateObject.power = PowerState.Off;
      
      await capturedOnSetHandler(true, mockCallback);
      
      expect(mockDeviceStateObject.setSleepMode).not.toHaveBeenCalled();
      expect(mockCacheManager.applyStateToDevice).not.toHaveBeenCalled();
      expect(platform.log.info).toHaveBeenCalledWith(expect.stringContaining('Cannot enable Sleep mode when AC is off'));
      expect(mockCallback).toHaveBeenCalledWith(null);
    });

    it('should handle errors and call callback with error', async () => {
      const mockCallback = vi.fn();
      mockCacheManager.applyStateToDevice.mockRejectedValue(new Error('Test error'));
      mockDeviceStateObject.toApiStatus.mockReturnValue({ is_on: PowerState.On });
      mockDeviceStateObject.power = PowerState.On;
      
      await capturedOnSetHandler(true, mockCallback);
      
      expect(mockCallback).toHaveBeenCalledWith(expect.objectContaining({
        status: platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      }));
    });
  });

  describe('stateChanged listener (from BaseSwitchAccessory)', () => {
    it('should update characteristic when state changes to sleep ON', () => {
      // Trigger the stateChanged listener with new state
      const newState = createMockDeviceState(defaultDeviceOptions);
      newState.toApiStatus.mockReturnValue({ 
        opt_sleepMode: SleepModeState.On, 
        is_on: PowerState.On, 
        opt_turbo: PowerState.Off,
        opt_sleep: PowerState.On
      });
      
      capturedStateChangeListener(newState);
      
      expect(mockService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, true);
    });

    it('should update characteristic when state changes to sleep OFF', () => {
      // Trigger the stateChanged listener with new state
      const newState = createMockDeviceState(defaultDeviceOptions);
      newState.toApiStatus.mockReturnValue({ 
        opt_sleepMode: SleepModeState.Off, 
        is_on: PowerState.On, 
        opt_turbo: PowerState.Off,
        opt_sleep: PowerState.Off
      });
      
      capturedStateChangeListener(newState);
      
      expect(mockService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, false);
    });
  });
});
