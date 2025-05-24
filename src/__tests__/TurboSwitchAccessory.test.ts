// filepath: /Users/denisletnikov/Code/homebridge-tfiac/src/__tests__/TurboSwitchAccessory.test.ts
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
      mockDeviceStateObject.toApiStatus.mockReturnValue({ opt_turbo: PowerState.On });
      inst = new TurboSwitchAccessory(platform, accessory);
      
      const result = inst.handleGet();
      
      expect(result).toBe(true);
    });

    it('should return false when turbo is off', () => {
      mockDeviceStateObject.toApiStatus.mockReturnValue({ opt_turbo: PowerState.Off });
      inst = new TurboSwitchAccessory(platform, accessory);
      
      const result = inst.handleGet();
      
      expect(result).toBe(false);
    });

    it('should handle null deviceState by returning false', () => {
      Object.defineProperty(inst, 'deviceState', { get: () => null });
      
      const result = inst.handleGet();
      
      expect(result).toBe(false);
    });
  });

  describe('handleSet', () => {
    it('should set turbo on and sleep mode off when value is true', async () => {
      const mockCallback = vi.fn();
      mockDeviceStateObject.power = PowerState.On; // Ensure AC is ON for Turbo to be set
      mockDeviceStateObject.turboMode = PowerState.Off; // Ensure turbo is initially off for change detection
      mockDeviceStateObject.sleepMode = PowerState.On; // Ensure sleep is initially on for change detection
      
      await capturedOnSetHandler(true, mockCallback);
      
      expect(mockDeviceStateObject.setTurboMode).toHaveBeenCalledWith(PowerState.On);
      expect(mockDeviceStateObject.setSleepMode).toHaveBeenCalledWith(SleepModeState.Off);
      expect(mockCacheManager.applyStateToDevice).toHaveBeenCalledWith(mockDeviceStateObject);
      expect(mockCallback).toHaveBeenCalledWith(null);
    });

    it('should set turbo off and rely on DeviceState harmonization when value is false', async () => {
      const mockCallback = vi.fn();
      mockDeviceStateObject.power = PowerState.On; // Ensure AC is ON for changes
      mockDeviceStateObject.turboMode = PowerState.On; // Ensure turbo is initially on for change detection
      mockDeviceStateObject.fanSpeed = FanSpeed.High; // Ensure fan speed is not auto for change detection
      
      await capturedOnSetHandler(false, mockCallback);
      
      // Only setTurboMode should be called - DeviceState harmonization handles fan speed reset
      expect(mockDeviceStateObject.setTurboMode).toHaveBeenCalledWith(PowerState.Off);
      expect(mockDeviceStateObject.setFanSpeed).not.toHaveBeenCalled();
      expect(mockCacheManager.applyStateToDevice).toHaveBeenCalledWith(mockDeviceStateObject);
      expect(mockCallback).toHaveBeenCalledWith(null);
    });

    it('should handle errors from applyStateToDevice', async () => {
      const mockCallback = vi.fn();
      
      // Create a HapStatusError for the platform
      const hapError = new platform.api.hap.HapStatusError(
        platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      );
      
      // Mock the applyStateToDevice to reject with our error
      mockCacheManager.applyStateToDevice.mockRejectedValueOnce(hapError);
      
      mockDeviceStateObject.power = PowerState.On; // Ensure AC is ON
      mockDeviceStateObject.turboMode = PowerState.Off; // Ensure initial state for action
      mockDeviceStateObject.sleepMode = PowerState.On; // For testing sleep mode turning off with turbo
      
      await capturedOnSetHandler(true, mockCallback);
      
      // Verify the error handling
      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          status: platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
        })
      );
    });
  });

  describe('stateChanged listener', () => {
    it('should update characteristic when turbo state changes to on', () => {
      const newState = createMockDeviceState(defaultDeviceOptions);
      newState.toApiStatus.mockReturnValue({ opt_turbo: PowerState.On });
      
      capturedStateChangeListener(newState);
      
      expect(mockService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, true);
    });

    it('should update characteristic when turbo state changes to off', () => {
      const newState = createMockDeviceState(defaultDeviceOptions);
      newState.toApiStatus.mockReturnValue({ opt_turbo: PowerState.Off });
      
      capturedStateChangeListener(newState);
      
      expect(mockService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, false);
    });
  });
});
