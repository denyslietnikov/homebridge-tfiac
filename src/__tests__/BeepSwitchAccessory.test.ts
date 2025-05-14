import { vi, it, expect, describe, beforeEach, afterEach } from 'vitest';
import { BeepSwitchAccessory } from '../BeepSwitchAccessory.js';
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

describe('BeepSwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: any;
  let mockService: any;
  let mockCharacteristicOn: any;
  let inst: BeepSwitchAccessory;
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
        deviceConfig: { ip: '192.168.1.100', port: 8080, name: 'Test AC Beep' },
      },
      displayName: 'Test AC Beep Display',
    };

    mockDeviceStateObject = createMockDeviceState(defaultDeviceOptions);
    mockDeviceStateObject.on = vi.fn((event, listener) => {
      if (event === 'stateChanged') {
        capturedStateChangeListener = listener;
      }
      return mockDeviceStateObject;
    });
    mockDeviceStateObject.setBeepMode = vi.fn();
    mockDeviceStateObject.clone = vi.fn().mockReturnValue(mockDeviceStateObject);

    mockCacheManager = createMockCacheManager();
    mockCacheManager.getDeviceState.mockReturnValue(mockDeviceStateObject);
    mockCacheManager.applyStateToDevice = vi.fn().mockResolvedValue(undefined);

    (CacheManager.getInstance as ReturnType<typeof vi.fn>).mockReturnValue(mockCacheManager);

    mockDeviceStateObject.toApiStatus.mockReturnValueOnce({ opt_beep: PowerState.Off, is_on: PowerState.Off });

    inst = new BeepSwitchAccessory(platform, accessory);
  });

  it('should construct and set up characteristics and listeners', () => {
    expect(accessory.getServiceById).toHaveBeenCalledWith(platform.Service.Switch.UUID, 'beep');
    expect(mockService.setCharacteristic).toHaveBeenCalledWith(platform.Characteristic.Name, 'Beep');
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
    it('should return true when beep is ON in deviceState', () => {
      vi.spyOn(mockDeviceStateObject, 'toApiStatus').mockReturnValue({ opt_beep: PowerState.On } as any);
      const result = inst.handleGet();
      expect(result).toBe(true);
    });

    it('should return false when beep is OFF in deviceState', () => {
      vi.spyOn(mockDeviceStateObject, 'toApiStatus').mockReturnValue({ opt_beep: PowerState.Off } as any);
      const result = inst.handleGet();
      expect(result).toBe(false);
    });

    it('should return false when toApiStatus returns null', () => {
      vi.spyOn(mockDeviceStateObject, 'toApiStatus').mockReturnValue(null as any);
      const result = inst.handleGet();
      expect(result).toBe(false);
    });
  });

  describe('handleSet (triggered via characteristic.onSet)', () => {
    it('should call applyStateToDevice with Beep ON when value is true', async () => {
      const callback = vi.fn();
      expect(capturedOnSetHandler).toBeDefined();
      await capturedOnSetHandler(true, callback);

      expect(mockDeviceStateObject.clone).toHaveBeenCalled();
      expect(mockDeviceStateObject.setBeepMode).toHaveBeenCalledWith(PowerState.On);
      expect(mockCacheManager.applyStateToDevice).toHaveBeenCalledWith(mockDeviceStateObject);
      expect(callback).toHaveBeenCalledWith(null);
    });

    it('should call applyStateToDevice with Beep OFF when value is false', async () => {
      const callback = vi.fn();
      expect(capturedOnSetHandler).toBeDefined();
      await capturedOnSetHandler(false, callback);

      expect(mockDeviceStateObject.clone).toHaveBeenCalled();
      expect(mockDeviceStateObject.setBeepMode).toHaveBeenCalledWith(PowerState.Off);
      expect(mockCacheManager.applyStateToDevice).toHaveBeenCalledWith(mockDeviceStateObject);
      expect(callback).toHaveBeenCalledWith(null);
    });

    it('should handle errors from applyStateToDevice', async () => {
      const callback = vi.fn();
      const error = new Error('Set Beep Error');
      mockCacheManager.applyStateToDevice.mockRejectedValueOnce(error);
      expect(capturedOnSetHandler).toBeDefined();
      await capturedOnSetHandler(true, callback);

      expect(callback).toHaveBeenCalledWith(expect.any(platform.api.hap.HapStatusError));
      const hapError = callback.mock.calls[0][0];
      expect(hapError.status).toBe(platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      expect(platform.log.error).toHaveBeenCalledWith(
        expect.stringContaining('[Beep] Error setting state to true: Set Beep Error'),
      );
    });
  });

  describe('DeviceState Listener (via handleStateChange and updateStatus)', () => {
    it('updates characteristic to true when beep state changes to ON', () => {
      mockService.updateCharacteristic.mockClear();

      const newApiStatus = { opt_beep: PowerState.On, is_on: PowerState.On } as Partial<AirConditionerStatus>;
      vi.spyOn(mockDeviceStateObject, 'toApiStatus').mockReturnValue(newApiStatus);

      expect(capturedStateChangeListener).toBeDefined();
      capturedStateChangeListener(mockDeviceStateObject as DeviceState);

      expect(mockService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, true);
    });

    it('updates characteristic to false when beep state changes to OFF', () => {
      mockService.updateCharacteristic.mockClear();
      const newApiStatus = { opt_beep: PowerState.Off, is_on: PowerState.On } as Partial<AirConditionerStatus>;
      vi.spyOn(mockDeviceStateObject, 'toApiStatus').mockReturnValue(newApiStatus);

      expect(capturedStateChangeListener).toBeDefined();
      capturedStateChangeListener(mockDeviceStateObject as DeviceState);
      expect(mockService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, false);
    });

    it('does not update characteristic if beep state remains ON', () => {
      mockService.updateCharacteristic.mockClear();
      const newApiStatus = { opt_beep: PowerState.On, is_on: PowerState.On } as Partial<AirConditionerStatus>;
      vi.spyOn(mockDeviceStateObject, 'toApiStatus').mockReturnValue(newApiStatus);
      mockCharacteristicOn.value = true;

      expect(capturedStateChangeListener).toBeDefined();
      capturedStateChangeListener(mockDeviceStateObject as DeviceState);
      capturedStateChangeListener(mockDeviceStateObject as DeviceState);
      mockService.updateCharacteristic.mockClear();
      capturedStateChangeListener(mockDeviceStateObject as DeviceState);
      expect(mockService.updateCharacteristic).not.toHaveBeenCalled();
    });
  });
});