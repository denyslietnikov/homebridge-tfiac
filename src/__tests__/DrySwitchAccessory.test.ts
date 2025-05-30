import { vi, describe, it, expect, beforeEach } from 'vitest';
import { defaultDeviceOptions, createMockDeviceState, createMockCacheManager, createMockPlatform } from './testUtils';
import { OperationMode } from '../enums';
import { TfiacPlatform } from '../platform';
import { PlatformAccessory, CharacteristicValue, CharacteristicSetCallback } from 'homebridge';
import { DeviceState } from '../state/DeviceState';
import { CacheManager } from '../CacheManager';
import { DrySwitchAccessory } from '../DrySwitchAccessory';

vi.mock('../CacheManager.js', () => ({
  CacheManager: {
    getInstance: vi.fn(),
  },
}));

describe('DrySwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let mockService: any;
  let mockCharacteristicOn: any;
  let inst: DrySwitchAccessory;
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
        deviceConfig: defaultDeviceOptions,
      },
      displayName: 'Test Dry Switch Accessory',
    } as unknown as PlatformAccessory;

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
    mockCacheManager.api = {
      setDeviceOptions: vi.fn().mockResolvedValue(undefined),
    };

    (CacheManager.getInstance as ReturnType<typeof vi.fn>).mockReturnValue(mockCacheManager);

    // Set initial state to Cool (non-Dry)
    mockDeviceStateObject.toApiStatus.mockReturnValue({ 
      operation_mode: OperationMode.Cool
    });

    inst = new DrySwitchAccessory(platform, accessory);
  });

  it('should set Dry=true when handleSet is called with true', async () => {
    const callback = vi.fn();
    await capturedOnSetHandler(true, callback);

    expect(mockDeviceStateObject.clone).toHaveBeenCalled();
    expect(mockCacheManager.applyStateToDevice).toHaveBeenCalled();

    expect(callback).toHaveBeenCalledWith(null);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should return true when handleGet is called and Dry status is true (cache fresh)', () => {
    // Set state to Dry
    mockDeviceStateObject.toApiStatus.mockReturnValue({ 
      operation_mode: OperationMode.Dry
    });
    inst = new DrySwitchAccessory(platform, accessory);
    
    const result = inst.handleGet();
    expect(result).toBe(true);
  });

  it('should return false when handleGet is called and initial state is Cool (cache fresh)', () => {
    // Set state to Cool
    mockDeviceStateObject.toApiStatus.mockReturnValue({ 
      operation_mode: OperationMode.Cool
    });
    inst = new DrySwitchAccessory(platform, accessory);
    
    const result = inst.handleGet();
    expect(result).toBe(false);
  });

  it('should return cached value (false) when cache is stale', () => {
    // Set state to Cool
    mockDeviceStateObject.toApiStatus.mockReturnValue({ 
      operation_mode: OperationMode.Cool
    });
    inst = new DrySwitchAccessory(platform, accessory);

    const result = inst.handleGet();
    expect(result).toBe(false);
  });

  it('should call callback with HAPStatusError when applyStateToDevice fails', async () => {
    const testError = new Error('API failure');
    mockCacheManager.applyStateToDevice.mockReset().mockImplementation(async () => {
      throw testError;
    });
    const callback = vi.fn();

    await capturedOnSetHandler(true, callback);

    expect(callback).toHaveBeenCalledWith(expect.any(platform.api.hap.HapStatusError));
    const errorArg = callback.mock.calls[0][0];
    expect(errorArg.status).toBe(platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
