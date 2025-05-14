import { vi, it, expect, describe, beforeEach, afterEach } from 'vitest';
import { EcoSwitchAccessory } from '../EcoSwitchAccessory.js';
import { PlatformAccessory, Service, CharacteristicValue, CharacteristicSetCallback } from 'homebridge';
import { TfiacPlatform } from '../platform.js';
import { createMockCacheManager, createMockDeviceState, createMockPlatform, defaultDeviceOptions } from './testUtils';
import { PowerState } from '../enums.js';
import { AirConditionerStatus } from '../AirConditionerAPI.js';
import { CacheManager } from '../CacheManager.js';
import { DeviceState } from '../state/DeviceState.js';

vi.mock('../CacheManager.js', () => ({
  CacheManager: {
    getInstance: vi.fn(),
  },
}));

describe('EcoSwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: any;
  let mockService: any;
  let mockCharacteristicOn: any;
  let inst: EcoSwitchAccessory;
  let mockCacheManager: any;
  let mockDeviceStateObject: any;
  let capturedStateChangeListener: (state: any) => void;
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
        deviceConfig: { ip: '192.168.1.100', port: 8080, name: 'Test AC Eco' },
      },
      displayName: 'Test AC Eco Display',
    };

    mockDeviceStateObject = createMockDeviceState(defaultDeviceOptions);
    mockDeviceStateObject.on = vi.fn((event, listener) => {
      if (event === 'stateChanged') {
        capturedStateChangeListener = listener;
      }
      return mockDeviceStateObject;
    });
    mockDeviceStateObject.setEcoMode = vi.fn();
    mockDeviceStateObject.clone = vi.fn().mockReturnValue(mockDeviceStateObject);

    mockCacheManager = createMockCacheManager();
    mockCacheManager.getDeviceState.mockReturnValue(mockDeviceStateObject);
    mockCacheManager.applyStateToDevice = vi.fn().mockResolvedValue(undefined);

    (CacheManager.getInstance as ReturnType<typeof vi.fn>).mockReturnValue(mockCacheManager);

    mockDeviceStateObject.toApiStatus.mockReturnValueOnce({ opt_eco: PowerState.Off, is_on: PowerState.Off });

    inst = new EcoSwitchAccessory(platform, accessory);
  });

  it('should construct and set up characteristics and listeners', () => {
    expect(accessory.getServiceById).toHaveBeenCalledWith(platform.Service.Switch.UUID, 'eco');
    expect(mockService.setCharacteristic).toHaveBeenCalledWith(platform.Characteristic.Name, 'Eco');
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
    it('should return true when eco is ON in cachedStatus', () => {
      inst.cachedStatus = { opt_eco: PowerState.On };
      const result = (inst as any).handleGet();
      expect(result).toBe(true);
    });

    it('should return false when eco is OFF in cachedStatus', () => {
      inst.cachedStatus = { opt_eco: PowerState.Off };
      const result = (inst as any).handleGet();
      expect(result).toBe(false);
    });
  });

  describe('handleSet (inherited from BaseSwitchAccessory)', () => {
    it('should call setEcoMode with ON when value is true', async () => {
      const mockCallback = vi.fn();
      await capturedOnSetHandler(true, mockCallback);
      
      expect(mockDeviceStateObject.setEcoMode).toHaveBeenCalledWith(PowerState.On);
      expect(mockCacheManager.applyStateToDevice).toHaveBeenCalledWith(mockDeviceStateObject);
      expect(mockCallback).toHaveBeenCalledWith(null);
    });

    it('should call setEcoMode with OFF when value is false', async () => {
      const mockCallback = vi.fn();
      await capturedOnSetHandler(false, mockCallback);
      
      expect(mockDeviceStateObject.setEcoMode).toHaveBeenCalledWith(PowerState.Off);
      expect(mockCacheManager.applyStateToDevice).toHaveBeenCalledWith(mockDeviceStateObject);
      expect(mockCallback).toHaveBeenCalledWith(null);
    });

    it('should handle errors and call callback with error', async () => {
      const mockCallback = vi.fn();
      const mockError = new Error('Test error');
      mockCacheManager.applyStateToDevice.mockRejectedValueOnce(mockError);
      
      await capturedOnSetHandler(true, mockCallback);
      
      expect(mockCallback).toHaveBeenCalledWith(expect.objectContaining({
        status: platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      }));
    });
  });

  describe('stateChanged listener (from BaseSwitchAccessory)', () => {
    it('should update characteristic when state changes', () => {
      // Trigger the stateChanged listener with new state
      const newState = createMockDeviceState(defaultDeviceOptions);
      newState.toApiStatus.mockReturnValueOnce({ opt_eco: PowerState.On });
      
      capturedStateChangeListener(newState);
      
      expect(mockService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, true);
    });
  });

  describe('setEcoState method', () => {
    it('should call setEcoMode with ON when value is true', async () => {
      await inst.setEcoState(true);
      
      expect(mockDeviceStateObject.setEcoMode).toHaveBeenCalledWith(PowerState.On);
      expect(mockCacheManager.applyStateToDevice).toHaveBeenCalledWith(mockDeviceStateObject);
    });

    it('should call setEcoMode with OFF when value is false', async () => {
      await inst.setEcoState(false);
      
      expect(mockDeviceStateObject.setEcoMode).toHaveBeenCalledWith(PowerState.Off);
      expect(mockCacheManager.applyStateToDevice).toHaveBeenCalledWith(mockDeviceStateObject);
    });
  });
});