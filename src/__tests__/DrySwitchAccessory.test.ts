import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import { defaultDeviceOptions, createMockService, hapConstants } from './testUtils';
import { PowerState, OperationMode, FanSpeed, SwingMode, SleepModeState } from '../enums';
import { TfiacPlatform } from '../platform';
import { PlatformAccessory, Service, CharacteristicValue, CharacteristicSetCallback } from 'homebridge';
import { DeviceState, PlainDeviceState } from '../state/DeviceState';

vi.setConfig({ testTimeout: 30000 });

const mockSetDeviceState = vi.fn();
const mockGetCachedStatus = vi.fn();
const mockUpdateCache = vi.fn();
const mockGetDeviceState = vi.fn();
const mockApplyStateToDevice = vi.fn();
const mockUpdateDeviceState = vi.fn();

describe('DrySwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let service: Service;
  let DrySwitchAccessoryModule: any;
  let drySwitchAccessoryInstance: any;
  let handlers: { getHandler: () => Promise<CharacteristicValue>; setHandler: (value: CharacteristicValue, callback: CharacteristicSetCallback) => Promise<void> };
  let mockDeviceStateInstance: DeviceState;
  let capturedStateChangeListener: ((state: DeviceState) => void) | undefined;
  let cacheManagerInstance: any;

  const createDeviceStateMock = (initialPlainState: Partial<PlainDeviceState>): DeviceState => {
    let internalState: PlainDeviceState = {
      power: PowerState.Off,
      operationMode: OperationMode.Auto,
      targetTemperature: 22,
      currentTemperature: 20,
      outdoorTemperature: null,
      fanSpeed: FanSpeed.Auto,
      swingMode: SwingMode.Off,
      turboMode: PowerState.Off,
      ecoMode: PowerState.Off,
      displayMode: PowerState.On,
      beepMode: PowerState.On,
      sleepMode: SleepModeState.Off,
      lastUpdated: new Date(),
      ...initialPlainState,
    };

    const mock: any = {
      on: vi.fn().mockImplementation((event: string, listener: (...args: any[]) => void) => {
        if (event === 'stateChanged' && mock === mockDeviceStateInstance && !capturedStateChangeListener) {
          capturedStateChangeListener = listener as (state: DeviceState) => void;
        }
        return mock;
      }),
      removeListener: vi.fn().mockReturnThis(),
      toApiStatus: vi.fn().mockImplementation(() => ({
        is_on: internalState.power,
        operation_mode: internalState.operationMode,
        target_temperature: internalState.targetTemperature,
        current_temperature: internalState.currentTemperature,
        outdoor_temperature: internalState.outdoorTemperature,
        fan_speed: internalState.fanSpeed,
        swing_mode: internalState.swingMode,
        turbo_mode: internalState.turboMode,
        eco_mode: internalState.ecoMode,
        display_on: internalState.displayMode,
        beep_on: internalState.beepMode,
        sleep_mode: internalState.sleepMode === SleepModeState.On,
      })),
      setOperationMode: vi.fn().mockImplementation((mode: OperationMode) => {
        internalState.operationMode = mode;
      }),
      clone: vi.fn().mockImplementation(() => {
        return createDeviceStateMock(internalState);
      }),
      get power() { return internalState.power; },
      get operationMode() { return internalState.operationMode; },
      get targetTemperature() { return internalState.targetTemperature; },
      get currentTemperature() { return internalState.currentTemperature; },
      get outdoorTemperature() { return internalState.outdoorTemperature; },
      get fanSpeed() { return internalState.fanSpeed; },
      get swingMode() { return internalState.swingMode; },
      get turboMode() { return internalState.turboMode; },
      get ecoMode() { return internalState.ecoMode; },
      get displayMode() { return internalState.displayMode; },
      get beepMode() { return internalState.beepMode; },
      get sleepMode() { return internalState.sleepMode; },
      get lastUpdated() { return internalState.lastUpdated; },
      updateFromApi: vi.fn(),
      emitStateChanged: vi.fn(),
    };
    return mock as DeviceState;
  };

  beforeEach(async () => {
    mockSetDeviceState.mockReset().mockResolvedValue(undefined);
    mockGetCachedStatus.mockReset();
    mockUpdateCache.mockReset();
    mockApplyStateToDevice.mockReset().mockImplementation(async (stateApplied: DeviceState) => {
      mockDeviceStateInstance.setOperationMode(stateApplied.operationMode);
      if (capturedStateChangeListener) {
        capturedStateChangeListener(mockDeviceStateInstance);
      }
      return;
    });
    mockUpdateDeviceState.mockReset().mockResolvedValue(undefined);

    capturedStateChangeListener = undefined;

    const initialMockPlainState: Partial<PlainDeviceState> = {
      power: PowerState.On,
      operationMode: OperationMode.Cool,
      targetTemperature: 22,
    };
    mockDeviceStateInstance = createDeviceStateMock(initialMockPlainState);

    mockGetDeviceState.mockReset().mockReturnValue(mockDeviceStateInstance);

    vi.resetModules();

    await vi.doMock('../AirConditionerAPI', () => {
      const apiInstance = { setDeviceState: mockSetDeviceState };
      return { AirConditionerAPI: vi.fn().mockImplementation(() => apiInstance), default: vi.fn().mockImplementation(() => apiInstance) };
    });

    cacheManagerInstance = {
      getCachedStatus: vi.fn().mockImplementation(() => Promise.resolve(mockDeviceStateInstance.toApiStatus())),
      updateCache: mockUpdateCache,
      getDeviceState: mockGetDeviceState,
      applyStateToDevice: mockApplyStateToDevice,
      updateDeviceState: mockUpdateDeviceState,
      isCacheFresh: vi.fn().mockReturnValue(true),
    };

    await vi.doMock('../CacheManager', () => {
      const CacheManagerMock = { getInstance: vi.fn().mockReturnValue(cacheManagerInstance) };
      return { CacheManager: CacheManagerMock, default: CacheManagerMock };
    });

    DrySwitchAccessoryModule = await import('../DrySwitchAccessory');

    platform = {
      log: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
      api: {
        hap: {
          Service: hapConstants.Service, Characteristic: hapConstants.Characteristic,
          HAPStatus: { SERVICE_COMMUNICATION_FAILURE: -70402, SUCCESS: 0 },
          HapStatusError: class HapStatusError extends Error { constructor(public hapStatus: number) { super(`HAPStatusError: ${hapStatus}`); } }
        }
      },
      Service: hapConstants.Service, Characteristic: hapConstants.Characteristic,
    } as unknown as TfiacPlatform;

    accessory = {
      context: { deviceConfig: defaultDeviceOptions }, getServiceById: vi.fn(), getService: vi.fn(),
      addService: vi.fn().mockReturnThis(), removeService: vi.fn().mockReturnThis(),
      displayName: 'Test Dry Switch Accessory', UUID: 'test-uuid', category: 1,
      services: [], reachable: true, on: vi.fn(), emit: vi.fn(), removeAllListeners: vi.fn(),
    } as unknown as PlatformAccessory;

    service = createMockService(hapConstants.Service.Switch.UUID, 'Dry');

    const mockOnCharacteristic = {
      onGet: vi.fn((handler) => { handlers.getHandler = handler; return mockOnCharacteristic; }),
      onSet: vi.fn((handler) => { handlers.setHandler = handler; return mockOnCharacteristic; }),
      updateValue: vi.fn(), props: {}, displayName: 'On', UUID: hapConstants.Characteristic.On.UUID,
    };

    service.getCharacteristic = vi.fn().mockImplementation((char) => {
      if (char === platform.Characteristic.On || char === platform.Characteristic.On.UUID) return mockOnCharacteristic;
      if (char === platform.Characteristic.Name) return { updateValue: vi.fn(), value: 'Dry' };
      return { onGet: vi.fn().mockReturnThis(), onSet: vi.fn().mockReturnThis(), updateValue: vi.fn(), props: {}, displayName: 'Unknown', UUID: 'unknown' };
    });
    service.setCharacteristic = vi.fn().mockReturnThis();

    (accessory.getService as Mock).mockReturnValue(service);
    (accessory.getServiceById as Mock).mockReturnValue(service);

    handlers = { getHandler: async () => false, setHandler: async () => { /* no-op */ } };

    drySwitchAccessoryInstance = new DrySwitchAccessoryModule.DrySwitchAccessory(platform, accessory);
  });

  it('should set Dry=true when handleSet is called with true', async () => {
    const callback = vi.fn();
    await handlers.setHandler(true, callback);

    expect(mockDeviceStateInstance.clone).toHaveBeenCalled();
    expect(mockApplyStateToDevice).toHaveBeenCalled();
    const stateSentToApi = (mockApplyStateToDevice.mock.calls[0][0] as DeviceState);
    expect(stateSentToApi.toApiStatus().operation_mode).toBe(OperationMode.Dry);

    expect(callback).toHaveBeenCalledWith(null);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should return true when handleGet is called and Dry status is true (cache fresh)', async () => {
    // Set state to Dry
    mockDeviceStateInstance.setOperationMode(OperationMode.Dry);

    (cacheManagerInstance.isCacheFresh as Mock).mockReturnValue(true);
    const result = await handlers.getHandler();
    expect(result).toBe(true);
  });

  it('should return false when handleGet is called and initial state is Cool (cache fresh)', async () => {
    // Set state to Cool
    mockDeviceStateInstance.setOperationMode(OperationMode.Cool);

    (cacheManagerInstance.isCacheFresh as Mock).mockReturnValue(true);
    const result = await handlers.getHandler();
    expect(result).toBe(false);
  });

  it('should return cached value (false) when cache is stale', () => {
    // Set state to Cool
    mockDeviceStateInstance.setOperationMode(OperationMode.Cool);

    (cacheManagerInstance.isCacheFresh as Mock).mockReturnValue(false);

    // handleGet is synchronous and does not auto-refresh cache
    const result = handlers.getHandler();
    expect(result).toBe(false);
  });

  it('should call callback with HAPStatusError when applyStateToDevice fails', async () => {
    const testError = new Error('API failure');
    mockApplyStateToDevice.mockReset().mockImplementation(async () => {
      throw testError;
    });
    const callback = vi.fn();

    await handlers.setHandler(true, callback);

    expect(callback).toHaveBeenCalledWith(expect.any(platform.api.hap.HapStatusError));
    const errorArg = callback.mock.calls[0][0];
    expect(errorArg.hapStatus).toBe(platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
