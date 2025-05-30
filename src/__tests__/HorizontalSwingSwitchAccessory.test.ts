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
    mockDeviceStateObject.setSwingMode = vi.fn(); // Added mock for setSwingMode
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
    mockCacheManager.getStatus = vi.fn().mockResolvedValue({ swingMode: SwingMode.Off });

    (CacheManager.getInstance as ReturnType<typeof vi.fn>).mockReturnValue(mockCacheManager);

    mockDeviceStateObject.toApiStatus.mockReturnValue({ 
      swing_mode: SwingMode.Off
    });

    inst = new HorizontalSwingSwitchAccessory(platform, accessory);
  });

  it('should construct and set up characteristics and listeners', () => {
    expect(accessory.getServiceById).toHaveBeenCalledWith(platform.Service.Switch.UUID, 'horizontalswing');
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
      mockDeviceStateObject.toApiStatus.mockReturnValue({ swing_mode: SwingMode.Horizontal });
      inst = new HorizontalSwingSwitchAccessory(platform, accessory);
      
      const result = inst.handleGet();
      expect(result).toBe(true);
    });

    it('should return true when swing_mode is Both', () => {
      mockDeviceStateObject.toApiStatus.mockReturnValue({ swing_mode: SwingMode.Both });
      inst = new HorizontalSwingSwitchAccessory(platform, accessory);
      
      const result = inst.handleGet();
      expect(result).toBe(true);
    });

    it('should return false when swing_mode is Off', () => {
      mockDeviceStateObject.toApiStatus.mockReturnValue({ swing_mode: SwingMode.Off });
      inst = new HorizontalSwingSwitchAccessory(platform, accessory);
      
      const result = inst.handleGet();
      expect(result).toBe(false);
    });

    it('should return false when swing_mode is Vertical', () => {
      mockDeviceStateObject.toApiStatus.mockReturnValue({ swing_mode: SwingMode.Vertical });
      inst = new HorizontalSwingSwitchAccessory(platform, accessory);
      
      const result = inst.handleGet();
      expect(result).toBe(false);
    });

    it('should handle null deviceState by returning false', () => {
      Object.defineProperty(inst, 'deviceState', { get: () => null });
      const result = inst.handleGet();
      expect(result).toBe(false);
    });
    const castedResult = result as { err: any, val: any };
    expect(castedResult.err).toBeNull();
    expect(castedResult.val).toBe(true);
  });

  describe('handleSet', () => {
    it('should set swing_mode to Horizontal when value is true and vertical is off', async () => {
      const mockCallback = vi.fn();
      mockDeviceStateObject.swingMode = SwingMode.Off; // Vertical is off
      
      await capturedOnSetHandler(true, mockCallback); // Request to turn horizontal ON
      
      expect(mockDeviceStateObject.setSwingMode).toHaveBeenCalledWith(SwingMode.Horizontal);
      expect(mockCacheManager.applyStateToDevice).toHaveBeenCalledWith(mockDeviceStateObject);
      expect(mockCallback).toHaveBeenCalledWith(null);
    });

    it('should set swing_mode to Both when value is true and vertical is on', async () => {
      const mockCallback = vi.fn();
      mockDeviceStateObject.swingMode = SwingMode.Vertical; // Vertical is on
      
      await capturedOnSetHandler(true, mockCallback); // Request to turn horizontal ON
      
      expect(mockDeviceStateObject.setSwingMode).toHaveBeenCalledWith(SwingMode.Both);
      expect(mockCacheManager.applyStateToDevice).toHaveBeenCalledWith(mockDeviceStateObject);
      expect(mockCallback).toHaveBeenCalledWith(null);
    });

    it('should set swing_mode to Off when value is false and vertical is off', async () => {
      const mockCallback = vi.fn();
      mockDeviceStateObject.swingMode = SwingMode.Horizontal; 
      
      await capturedOnSetHandler(false, mockCallback); // Request to turn horizontal OFF
      
      expect(mockDeviceStateObject.setSwingMode).toHaveBeenCalledWith(SwingMode.Off);
      expect(mockCacheManager.applyStateToDevice).toHaveBeenCalledWith(mockDeviceStateObject);
      expect(mockCallback).toHaveBeenCalledWith(null);
    });

    it('should set swing_mode to Vertical when value is false and vertical is on', async () => {
      const mockCallback = vi.fn();
      mockDeviceStateObject.swingMode = SwingMode.Both; 
      
      await capturedOnSetHandler(false, mockCallback); // Request to turn horizontal OFF
      
      expect(mockDeviceStateObject.setSwingMode).toHaveBeenCalledWith(SwingMode.Vertical);
      expect(mockCacheManager.applyStateToDevice).toHaveBeenCalledWith(mockDeviceStateObject);
      expect(mockCallback).toHaveBeenCalledWith(null);
    });

    it('should handle errors and call callback with error', async () => {
      const mockCallback = vi.fn();
      
      // Create a HapStatusError for the platform
      const hapError = new platform.api.hap.HapStatusError(
        platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      );
      
      // Mock the applyStateToDevice to reject with our error
      mockCacheManager.applyStateToDevice.mockRejectedValueOnce(hapError);
      mockDeviceStateObject.swingMode = SwingMode.Off; 
      
      await capturedOnSetHandler(true, mockCallback);
      
      expect(mockDeviceStateObject.setSwingMode).toHaveBeenCalledWith(SwingMode.Horizontal);
      expect(mockCacheManager.applyStateToDevice).toHaveBeenCalledWith(mockDeviceStateObject);
      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          status: platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
        })
      );
    });
    const castedResult = result as { err: any, val: any };
    expect(castedResult.err).toBeNull();
    expect(castedResult.val).toBe(false);
  });

  describe('stateChanged listener', () => {
    it('should update characteristic when state changes to horizontal on', () => {
      const newState = createMockDeviceState(defaultDeviceOptions);
      newState.toApiStatus.mockReturnValue({ swing_mode: SwingMode.Horizontal });
      
      capturedStateChangeListener(newState);
      
      expect(mockService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, true);
    });

    it('should update characteristic when state changes to both on', () => {
      const newState = createMockDeviceState(defaultDeviceOptions);
      newState.toApiStatus.mockReturnValue({ swing_mode: SwingMode.Both });
      
      capturedStateChangeListener(newState);
      
      expect(mockService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, true);
    });

    it('should update characteristic when state changes to off', () => {
      const newState = createMockDeviceState(defaultDeviceOptions);
      newState.toApiStatus.mockReturnValue({ swing_mode: SwingMode.Off });
      
      capturedStateChangeListener(newState);
      
      expect(mockService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, false);
    });

    it('should update characteristic when state changes to vertical only', () => {
      const newState = createMockDeviceState(defaultDeviceOptions);
      newState.toApiStatus.mockReturnValue({ swing_mode: SwingMode.Vertical });
      
      capturedStateChangeListener(newState);
      
      expect(mockService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, false);
    });
  });
});