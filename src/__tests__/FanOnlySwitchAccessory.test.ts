import { vi, it, expect, describe, beforeEach, afterEach } from 'vitest';
import { FanOnlySwitchAccessory } from '../FanOnlySwitchAccessory.js';
import { PlatformAccessory, Service, CharacteristicValue, CharacteristicSetCallback } from 'homebridge';
import { TfiacPlatform } from '../platform.js';
import { createMockCacheManager, createMockDeviceState, createMockPlatform, defaultDeviceOptions } from './testUtils';
import { PowerState, OperationMode } from '../enums.js';
import { AirConditionerStatus } from '../AirConditionerAPI.js';
import { CacheManager } from '../CacheManager.js';
import { DeviceState } from '../state/DeviceState.js';

vi.mock('../CacheManager.js', () => ({
  CacheManager: {
    getInstance: vi.fn(),
  },
}));

describe('FanOnlySwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: any;
  let mockService: any;
  let mockCharacteristicOn: any;
  let inst: FanOnlySwitchAccessory;
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
        deviceConfig: { ip: '192.168.1.100', port: 8080, name: 'Test AC Fan Only' },
      },
      displayName: 'Test AC Fan Only Display',
    };

    mockDeviceStateObject = createMockDeviceState(defaultDeviceOptions);
    mockDeviceStateObject.on = vi.fn((event, listener) => {
      if (event === 'stateChanged') {
        capturedStateChangeListener = listener;
      }
      return mockDeviceStateObject;
    });
    mockDeviceStateObject.setOperationMode = vi.fn();
    mockDeviceStateObject.clone = vi.fn().mockReturnValue(mockDeviceStateObject);

    mockCacheManager = createMockCacheManager();
    mockCacheManager.getDeviceState.mockReturnValue(mockDeviceStateObject);
    mockCacheManager.applyStateToDevice = vi.fn().mockResolvedValue(undefined);

    (CacheManager.getInstance as ReturnType<typeof vi.fn>).mockReturnValue(mockCacheManager);

    mockDeviceStateObject.toApiStatus.mockReturnValueOnce({ operation_mode: OperationMode.Auto, is_on: PowerState.Off });

    inst = new FanOnlySwitchAccessory(platform, accessory);
  });

  it('should construct and set up characteristics and listeners', () => {
    expect(accessory.getServiceById).toHaveBeenCalledWith(platform.Service.Switch.UUID, 'fanonly');
    expect(mockService.setCharacteristic).toHaveBeenCalledWith(platform.Characteristic.Name, 'Fan Only');
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
    it('should return true when operation_mode is FanOnly', () => {
      vi.spyOn(mockDeviceStateObject, 'toApiStatus').mockReturnValue({ operation_mode: OperationMode.FanOnly } as any);
      const result = (inst as any).handleGet();
      expect(result).toBe(true);
    });

    it('should return false when operation_mode is not FanOnly', () => {
      vi.spyOn(mockDeviceStateObject, 'toApiStatus').mockReturnValue({ operation_mode: OperationMode.Auto } as any);
      const result = (inst as any).handleGet();
      expect(result).toBe(false);
    });
  });

  describe('handleSet (inherited from BaseSwitchAccessory)', () => {
    it('should call setOperationMode with FanOnly when value is true', async () => {
      const mockCallback = vi.fn();
      await capturedOnSetHandler(true, mockCallback);
      
      expect(mockDeviceStateObject.setOperationMode).toHaveBeenCalledWith(OperationMode.FanOnly);
      expect(mockCacheManager.applyStateToDevice).toHaveBeenCalledWith(mockDeviceStateObject);
      expect(mockCallback).toHaveBeenCalledWith(null);
    });

    it('should call setOperationMode with Auto when value is false', async () => {
      const mockCallback = vi.fn();
      await capturedOnSetHandler(false, mockCallback);
      
      expect(mockDeviceStateObject.setOperationMode).toHaveBeenCalledWith(OperationMode.Auto);
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
    it('should update characteristic when state changes to FanOnly', () => {
      const newState = createMockDeviceState(defaultDeviceOptions);
      newState.toApiStatus.mockReturnValueOnce({ operation_mode: OperationMode.FanOnly });
      
      capturedStateChangeListener(newState);
      
      expect(mockService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, true);
    });

    it('should update characteristic when state changes to another mode', () => {
      const newState = createMockDeviceState(defaultDeviceOptions);
      newState.toApiStatus.mockReturnValueOnce({ operation_mode: OperationMode.Cool });
      
      capturedStateChangeListener(newState);
      
      expect(mockService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, false);
    });
  });
});