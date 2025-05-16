import { vi, it, expect, describe, beforeEach, afterEach } from 'vitest';
import { HorizontalSwingSwitchAccessory } from '../HorizontalSwingSwitchAccessory.js';
import { PlatformAccessory, Service, CharacteristicValue, CharacteristicSetCallback } from 'homebridge';
import { TfiacPlatform } from '../platform.js';
import { createMockCacheManager, createMockDeviceState, createMockPlatform, defaultDeviceOptions } from './testUtils';
import { PowerState, SwingMode } from '../enums.js';
import { AirConditionerStatus } from '../AirConditionerAPI.js';
import { CacheManager } from '../CacheManager.js';
import { DeviceState } from '../state/DeviceState.js';

vi.mock('../CacheManager.js', () => ({
  CacheManager: {
    getInstance: vi.fn(),
  },
}));

describe('HorizontalSwingSwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: any;
  let mockService: any;
  let mockCharacteristicOn: any;
  let inst: HorizontalSwingSwitchAccessory;
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
        deviceConfig: { ip: '192.168.1.100', port: 8080, name: 'Test AC Horizontal Swing' },
      },
      displayName: 'Test AC Horizontal Swing Display',
    };

    mockDeviceStateObject = createMockDeviceState(defaultDeviceOptions);
    mockDeviceStateObject.on = vi.fn((event, listener) => {
      if (event === 'stateChanged') {
        capturedStateChangeListener = listener;
      }
      return mockDeviceStateObject;
    });
    mockDeviceStateObject.swingMode = SwingMode.Off;
    mockDeviceStateObject.clone = vi.fn().mockReturnValue(mockDeviceStateObject);

    mockCacheManager = createMockCacheManager();
    mockCacheManager.getDeviceState.mockReturnValue(mockDeviceStateObject);
    mockCacheManager.applyStateToDevice = vi.fn().mockResolvedValue(undefined);
    mockCacheManager.api = {
      setDeviceOptions: vi.fn().mockResolvedValue(undefined),
    };
    mockCacheManager.getStatus = vi.fn().mockResolvedValue({ swingMode: SwingMode.Off });

    (CacheManager.getInstance as ReturnType<typeof vi.fn>).mockReturnValue(mockCacheManager);

    mockDeviceStateObject.toApiStatus.mockReturnValue({ 
      swing_mode: SwingMode.Off
    });

    inst = new HorizontalSwingSwitchAccessory(platform, accessory);
  });

  it('should construct and set up characteristics and listeners', () => {
    expect(accessory.getServiceById).toHaveBeenCalledWith(platform.Service.Switch.UUID, 'horizontal_swing');
    expect(mockService.setCharacteristic).toHaveBeenCalledWith(platform.Characteristic.Name, 'Horizontal Swing');
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
    it('should return true when swing_mode is Horizontal', () => {
      mockDeviceStateObject.swingMode = SwingMode.Horizontal;
      const result = inst.handleGet();
      expect(result).toBe(true);
    });

    it('should return true when swing_mode is Both', () => {
      mockDeviceStateObject.swingMode = SwingMode.Both;
      const result = inst.handleGet();
      expect(result).toBe(true);
    });

    it('should return false when swing_mode is Off', () => {
      mockDeviceStateObject.swingMode = SwingMode.Off;
      const result = inst.handleGet();
      expect(result).toBe(false);
    });

    it('should return false when swing_mode is Vertical', () => {
      mockDeviceStateObject.swingMode = SwingMode.Vertical;
      const result = inst.handleGet();
      expect(result).toBe(false);
    });

    it('should handle null deviceState by returning false', () => {
      Object.defineProperty(inst, 'deviceState', { get: () => null });
      const result = inst.handleGet();
      expect(result).toBe(false);
    });

    it('should call callback with the result if provided', () => {
      mockDeviceStateObject.swingMode = SwingMode.Horizontal;
      const callback = vi.fn();
      const result = inst.handleGet(callback);
      expect(result).toBe(true);
      expect(callback).toHaveBeenCalledWith(null, true);
    });
  });

  describe('handleSet', () => {
    it('should set swing_mode to Horizontal when value is true and vertical is off', async () => {
      const mockCallback = vi.fn();
      mockDeviceStateObject.swingMode = SwingMode.Off;
      
      await capturedOnSetHandler(true, mockCallback);
      
      expect(mockCacheManager.api.setDeviceOptions).toHaveBeenCalledWith({ swingMode: SwingMode.Horizontal });
      expect(mockCallback).toHaveBeenCalledWith(null);
    });

    it('should set swing_mode to Both when value is true and vertical is on', async () => {
      const mockCallback = vi.fn();
      mockDeviceStateObject.swingMode = SwingMode.Vertical;
      
      await capturedOnSetHandler(true, mockCallback);
      
      expect(mockCacheManager.api.setDeviceOptions).toHaveBeenCalledWith({ swingMode: SwingMode.Both });
      expect(mockCallback).toHaveBeenCalledWith(null);
    });

    it('should set swing_mode to Off when value is false and vertical is off', async () => {
      const mockCallback = vi.fn();
      mockDeviceStateObject.swingMode = SwingMode.Horizontal;
      
      await capturedOnSetHandler(false, mockCallback);
      
      expect(mockCacheManager.api.setDeviceOptions).toHaveBeenCalledWith({ swingMode: SwingMode.Off });
      expect(mockCallback).toHaveBeenCalledWith(null);
    });

    it('should set swing_mode to Vertical when value is false and vertical is on', async () => {
      const mockCallback = vi.fn();
      mockDeviceStateObject.swingMode = SwingMode.Both;
      
      await capturedOnSetHandler(false, mockCallback);
      
      expect(mockCacheManager.api.setDeviceOptions).toHaveBeenCalledWith({ swingMode: SwingMode.Vertical });
      expect(mockCallback).toHaveBeenCalledWith(null);
    });

    it('should handle errors and call callback with error', async () => {
      const mockCallback = vi.fn();
      const mockError = new Error('Test error');
      mockCacheManager.api.setDeviceOptions.mockRejectedValue(mockError);
      
      await capturedOnSetHandler(true, mockCallback);
      
      expect(mockCallback).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should fetch status from API if deviceState swingMode is not available', async () => {
      const mockCallback = vi.fn();
      mockDeviceStateObject.swingMode = undefined;
      const mockStatus = { swingMode: SwingMode.Vertical };
      mockCacheManager.getStatus.mockResolvedValue(mockStatus);
      
      await capturedOnSetHandler(true, mockCallback);
      
      expect(mockCacheManager.getStatus).toHaveBeenCalled();
      expect(mockCacheManager.api.setDeviceOptions).toHaveBeenCalledWith({ swingMode: SwingMode.Both });
      expect(mockCallback).toHaveBeenCalledWith(null);
    });

    it('should handle error when status cannot be retrieved', async () => {
      const mockCallback = vi.fn();
      mockDeviceStateObject.swingMode = undefined;
      mockCacheManager.getStatus.mockResolvedValue(null);
      
      await capturedOnSetHandler(true, mockCallback);
      
      expect(mockCacheManager.getStatus).toHaveBeenCalled();
      expect(mockCallback).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('stateChanged listener', () => {
    it('should update characteristic when state changes to horizontal on', () => {
      // Trigger the stateChanged listener with new state
      const newState = createMockDeviceState(defaultDeviceOptions);
      newState.toApiStatus.mockReturnValue({ swing_mode: SwingMode.Horizontal });
      
      capturedStateChangeListener(newState);
      
      expect(mockService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, true);
    });

    it('should update characteristic when state changes to both on', () => {
      // Trigger the stateChanged listener with new state
      const newState = createMockDeviceState(defaultDeviceOptions);
      newState.toApiStatus.mockReturnValue({ swing_mode: SwingMode.Both });
      
      capturedStateChangeListener(newState);
      
      expect(mockService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, true);
    });

    it('should update characteristic when state changes to off', () => {
      // Trigger the stateChanged listener with new state
      const newState = createMockDeviceState(defaultDeviceOptions);
      newState.toApiStatus.mockReturnValue({ swing_mode: SwingMode.Off });
      
      capturedStateChangeListener(newState);
      
      expect(mockService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, false);
    });

    it('should update characteristic when state changes to vertical only', () => {
      // Trigger the stateChanged listener with new state
      const newState = createMockDeviceState(defaultDeviceOptions);
      newState.toApiStatus.mockReturnValue({ swing_mode: SwingMode.Vertical });
      
      capturedStateChangeListener(newState);
      
      expect(mockService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, false);
    });
  });
});