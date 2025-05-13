import { vi, it, expect, describe, beforeEach, afterEach } from 'vitest';
import { TurboSwitchAccessory } from '../TurboSwitchAccessory.js';
import { PlatformAccessory, Service, CharacteristicValue, CharacteristicSetCallback } from 'homebridge';
import { TfiacPlatform } from '../platform.js';
import { createMockCacheManager, createMockDeviceState, createMockPlatform, defaultDeviceOptions } from './testUtils';
import { PowerState, FanSpeed, SleepModeState } from '../enums.js';
import { AirConditionerStatus } from '../AirConditionerAPI.js';
import { CacheManager } from '../CacheManager.js';
import { DeviceState } from '../state/DeviceState.js';

vi.mock('../CacheManager.js', () => ({
  CacheManager: {
    getInstance: vi.fn(),
  },
}));

describe('TurboSwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: any;
  let mockService: any;
  let mockCharacteristicOn: any;
  let inst: TurboSwitchAccessory;
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
        deviceConfig: { ip: '192.168.1.100', port: 8080, name: 'Test AC Turbo' },
      },
      displayName: 'Test AC Turbo Display',
    };

    mockDeviceStateObject = createMockDeviceState(defaultDeviceOptions);
    mockDeviceStateObject.on = vi.fn((event, listener) => {
      if (event === 'stateChanged') {
        capturedStateChangeListener = listener;
      }
      return mockDeviceStateObject;
    });
    mockDeviceStateObject.setTurboMode = vi.fn();
    mockDeviceStateObject.setSleepMode = vi.fn();
    mockDeviceStateObject.setFanSpeed = vi.fn();
    mockDeviceStateObject.clone = vi.fn().mockReturnValue(mockDeviceStateObject);

    mockCacheManager = createMockCacheManager();
    mockCacheManager.getDeviceState.mockReturnValue(mockDeviceStateObject);
    mockCacheManager.applyStateToDevice = vi.fn().mockResolvedValue(undefined);
    mockCacheManager.api = {
      setDeviceOptions: vi.fn().mockResolvedValue(undefined),
    };

    (CacheManager.getInstance as ReturnType<typeof vi.fn>).mockReturnValue(mockCacheManager);

    mockDeviceStateObject.toApiStatus.mockReturnValue({ 
      opt_turbo: PowerState.Off 
    });

    inst = new TurboSwitchAccessory(platform, accessory);
  });

  it('should construct and set up characteristics and listeners', () => {
    expect(accessory.getServiceById).toHaveBeenCalledWith(platform.Service.Switch.UUID, 'turbo');
    expect(mockService.setCharacteristic).toHaveBeenCalledWith(platform.Characteristic.Name, 'Turbo');
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

  describe('handleGet', () => {
    it('should return true when turbo is on', () => {
      // Need to mock both the API status and update the DeviceState object
      mockDeviceStateObject.toApiStatus.mockReturnValue({ opt_turbo: PowerState.On });
      // Simulate the accessor by creating a new instance after setting up mocks
      inst = new TurboSwitchAccessory(platform, accessory);
      
      const result = inst.handleGet();
      
      expect(result).toBe(true);
    });

    it('should return false when turbo is off', () => {
      mockDeviceStateObject.toApiStatus.mockReturnValue({ opt_turbo: PowerState.Off });
      // Simulate the accessor by creating a new instance after setting up mocks
      inst = new TurboSwitchAccessory(platform, accessory);
      
      const result = inst.handleGet();
      
      expect(result).toBe(false);
    });

    it('should handle null deviceState by returning false', () => {
      Object.defineProperty(inst, 'deviceState', { get: () => null });
      
      const result = inst.handleGet();
      
      expect(result).toBe(false);
    });

    it('should call callback with the result if provided', () => {
      mockDeviceStateObject.toApiStatus.mockReturnValue({ opt_turbo: PowerState.On });
      // Simulate the accessor by creating a new instance after setting up mocks
      inst = new TurboSwitchAccessory(platform, accessory);
      
      // BaseSwitchAccessory.handleGet doesn't use callbacks anymore
      // Just call the function and check the return value
      const result = inst.handleGet();
      
      expect(result).toBe(true);
    });
  });

  describe('handleSet', () => {
    it('should set turbo on and sleep mode off when value is true', async () => {
      const mockCallback = vi.fn();
      
      await capturedOnSetHandler(true, mockCallback);
      
      expect(mockDeviceStateObject.setTurboMode).toHaveBeenCalledWith(PowerState.On);
      expect(mockDeviceStateObject.setSleepMode).toHaveBeenCalledWith(SleepModeState.Off);
      expect(mockCacheManager.applyStateToDevice).toHaveBeenCalledWith(mockDeviceStateObject);
      expect(mockCallback).toHaveBeenCalledWith(null);
    });

    it('should set turbo off and fan speed to auto when value is false', async () => {
      const mockCallback = vi.fn();
      
      await capturedOnSetHandler(false, mockCallback);
      
      expect(mockDeviceStateObject.setTurboMode).toHaveBeenCalledWith(PowerState.Off);
      expect(mockDeviceStateObject.setFanSpeed).toHaveBeenCalledWith(FanSpeed.Auto);
      expect(mockCacheManager.applyStateToDevice).toHaveBeenCalledWith(mockDeviceStateObject);
      expect(mockCallback).toHaveBeenCalledWith(null);
    });

    it('should handle errors from applyStateToDevice', async () => {
      const mockCallback = vi.fn();
      const mockError = new Error('Test error');
      mockCacheManager.applyStateToDevice.mockRejectedValue(mockError);
      
      await capturedOnSetHandler(true, mockCallback);
      
      expect(mockCallback).toHaveBeenCalledWith(expect.objectContaining({
        status: platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      }));
    });
  });

  describe('stateChanged listener', () => {
    it('should update characteristic when turbo state changes to on', () => {
      // Trigger the stateChanged listener with new state
      const newState = createMockDeviceState(defaultDeviceOptions);
      newState.toApiStatus.mockReturnValue({ opt_turbo: PowerState.On });
      
      capturedStateChangeListener(newState);
      
      expect(mockService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, true);
    });

    it('should update characteristic when turbo state changes to off', () => {
      // Trigger the stateChanged listener with new state
      const newState = createMockDeviceState(defaultDeviceOptions);
      newState.toApiStatus.mockReturnValue({ opt_turbo: PowerState.Off });
      
      capturedStateChangeListener(newState);
      
      expect(mockService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, false);
    });
  });
});