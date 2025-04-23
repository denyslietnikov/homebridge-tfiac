// @ts-nocheck
// platformAccessory.test.ts

import {
  PlatformAccessory,
  Characteristic,
  CharacteristicValue,
  CharacteristicSetCallback,
  CharacteristicGetCallback,
  Categories,
  Logger,
  API,
  Service,
} from 'homebridge';
import { TfiacPlatform } from '../platform';
import { TfiacPlatformAccessory } from '../platformAccessory';
import AirConditionerAPI, { AirConditionerStatus } from '../AirConditionerAPI';
import { TfiacDeviceConfig } from '../settings';
import { jest, describe, beforeEach, afterEach, it, expect, beforeAll } from '@jest/globals';

// --- Mock AirConditionerAPI ---

const mockApiActions = {
  updateState: jest.fn<Promise<AirConditionerStatus>, []>(),
  turnOn: jest.fn<Promise<void>, []>(),
  turnOff: jest.fn<Promise<void>, []>(),
  setAirConditionerState: jest.fn<Promise<void>, []>(),
  setFanSpeed: jest.fn<Promise<void>, []>(),
  setSwingMode: jest.fn<Promise<void>, []>(),
  setTurboState: jest.fn<Promise<void>, []>(),
  cleanup: jest.fn<Promise<void>, []>(),
};

jest.mock('../AirConditionerAPI', () => {
  return jest.fn().mockImplementation(() => {
    return mockApiActions;
  });
});

// --- Types for Mocked Homebridge Components ---
type MockCharacteristicGetHandler = (callback: CharacteristicGetCallback) => void | Promise<CharacteristicValue>;
type MockCharacteristicSetHandler = (value: CharacteristicValue, callback: CharacteristicSetCallback) => void | Promise<void>;

interface MockCharacteristic {
  getHandler?: MockCharacteristicGetHandler;
  setHandler?: MockCharacteristicSetHandler;
  on(event: 'get', handler: MockCharacteristicGetHandler): MockCharacteristic;
  on(event: 'set', handler: MockCharacteristicSetHandler): MockCharacteristic;
  setProps: jest.Mock<() => MockCharacteristic>;
  updateValue: jest.Mock<(value: CharacteristicValue) => MockCharacteristic>;
  value: CharacteristicValue | null;
}

interface MockService {
  getCharacteristic: jest.Mock<(charIdentifier: string | typeof Characteristic) => MockCharacteristic>;
  setCharacteristic: jest.Mock<(charIdentifier: string | typeof Characteristic, value: CharacteristicValue) => MockService>;
  characteristics: Map<string, MockCharacteristic>;
}

// --- Factory for Mock Characteristic ---
const createMockCharacteristic = (): MockCharacteristic => {
  const onMethod = function(
    this: MockCharacteristic,
    event: 'get' | 'set',
    handler: MockCharacteristicGetHandler | MockCharacteristicSetHandler,
  ): MockCharacteristic {
    if (event === 'get') {
      this.getHandler = handler as MockCharacteristicGetHandler;
    } else {
      this.setHandler = handler as MockCharacteristicSetHandler;
    }
    return this;
  };
  const mockChar: MockCharacteristic = {
    value: null, getHandler: undefined, setHandler: undefined,
    on: jest.fn(onMethod),
    setProps: jest.fn<() => MockCharacteristic>().mockReturnThis(),
    updateValue: jest.fn(function(this: MockCharacteristic, newValue: CharacteristicValue) {
      this.value = newValue; return this;
    }),
  };
  return mockChar;
};

// --- Factory for Mock Service ---
const createMockService = (): any => {
  const characteristics = new Map<string, MockCharacteristic>();
  const mockSvc: any = {
    characteristics,
    getCharacteristic: jest.fn(
      (charIdentifier: string | typeof Characteristic) => {
        const key = (charIdentifier && typeof charIdentifier === 'object' && 'UUID' in charIdentifier)
          ? (charIdentifier as { UUID: string }).UUID
          : String(charIdentifier);
        if (!characteristics.has(key)) {
          characteristics.set(key, createMockCharacteristic());
        }
        return characteristics.get(key)!;
      }),
    setCharacteristic: jest.fn(function(this: MockService, charIdentifier: string | typeof Characteristic, value: CharacteristicValue) {
      const mockChar = this.getCharacteristic(charIdentifier); mockChar.updateValue(value); return this;
    }),
    updateCharacteristic: jest.fn(function(this: MockService, charIdentifier: string | typeof Characteristic, value: any) {
      return this.setCharacteristic(charIdentifier, value);
    }),
  };
  return mockSvc;
};

// --- Mock Homebridge HAP Definitions ---
const hapIdentifiers = {
  Service: { 
    HeaterCooler: 'HeaterCooler',
    TemperatureSensor: 'TemperatureSensor'
  },
  Characteristic: {
    Name: 'Name',
    On: 'On',
    Active: 'Active',
    CurrentHeaterCoolerState: 'CurrentHeaterCoolerState',
    TargetHeaterCoolerState: 'TargetHeaterCoolerState',
    CurrentTemperature: 'CurrentTemperature',
    CoolingThresholdTemperature: 'CoolingThresholdTemperature',
    HeatingThresholdTemperature: 'HeatingThresholdTemperature',
    RotationSpeed: 'RotationSpeed',
    SwingMode: 'SwingMode',
    TemperatureDisplayUnits: 'TemperatureDisplayUnits',
  },
};

const hapConstants = {
  Characteristic: {
    Active: { ACTIVE: 1, INACTIVE: 0, UUID: hapIdentifiers.Characteristic.Active },
    CurrentHeaterCoolerState: { INACTIVE: 0, IDLE: 1, HEATING: 2, COOLING: 3, UUID: hapIdentifiers.Characteristic.CurrentHeaterCoolerState },
    TargetHeaterCoolerState: { AUTO: 0, HEAT: 1, COOL: 2, UUID: hapIdentifiers.Characteristic.TargetHeaterCoolerState },
    SwingMode: { SWING_DISABLED: 0, SWING_ENABLED: 1, UUID: hapIdentifiers.Characteristic.SwingMode },
    TemperatureDisplayUnits: { CELSIUS: 0, FAHRENHEIT: 1, UUID: hapIdentifiers.Characteristic.TemperatureDisplayUnits },
    Name: { UUID: hapIdentifiers.Characteristic.Name },
    CurrentTemperature: { UUID: hapIdentifiers.Characteristic.CurrentTemperature },
    CoolingThresholdTemperature: { UUID: hapIdentifiers.Characteristic.CoolingThresholdTemperature },
    HeatingThresholdTemperature: { UUID: hapIdentifiers.Characteristic.HeatingThresholdTemperature },
    RotationSpeed: { UUID: hapIdentifiers.Characteristic.RotationSpeed },
    On: { UUID: hapIdentifiers.Characteristic.On },
  },
};

// --- Mock TfiacPlatform ---
const mockLogger: jest.Mocked<Logger> = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  success: jest.fn(),
  log: jest.fn(),
  prefix: '',
};

const mockPlatform = {
  log: mockLogger,
  api: { hap: { Service: hapIdentifiers.Service, Characteristic: hapConstants.Characteristic } } as unknown as API,
  Service: hapIdentifiers.Service,
  Characteristic: hapConstants.Characteristic,
} as unknown as TfiacPlatform;

// --- Mock PlatformAccessory ---
let mockAccessoryInstance: PlatformAccessory;
const mockServiceInstance = createMockService();

const initialStatusCelsius: AirConditionerStatus = {
  is_on: 'off',
  current_temp: 22,
  target_temp: 20,
  operation_mode: 'cool',
  fan_mode: 'Auto',
  swing_mode: 'Off',
};

const toFahrenheit = (status: AirConditionerStatus): AirConditionerStatus => ({
  ...status,
  current_temp: Math.round((status.current_temp * 9/5) + 32),
  target_temp: Math.round((status.target_temp * 9/5) + 32),
});

const initialStatusFahrenheit = toFahrenheit(initialStatusCelsius);

// Helper type for test context
interface TestAccessoryContext {
  pollingInterval: NodeJS.Timeout | null;
  cachedStatus: AirConditionerStatus | null;
  deviceAPI?: { cleanup?: () => void };
  stopPolling?: () => void;
}

// --- The Test Suite ---
describe('TfiacPlatformAccessory', () => {
  let accessory: TfiacPlatformAccessory;
  let deviceConfig: TfiacDeviceConfig;

  beforeAll(() => {
    jest.setTimeout(10000);
  });

  beforeEach(() => {
    jest.useFakeTimers();
    Object.values(mockApiActions).forEach(mockFn => mockFn.mockClear());

    mockApiActions.updateState.mockResolvedValue({ ...initialStatusFahrenheit });
    mockApiActions.turnOn.mockResolvedValue(undefined);
    mockApiActions.turnOff.mockResolvedValue(undefined);
    mockApiActions.setAirConditionerState.mockResolvedValue(undefined);
    mockApiActions.setFanSpeed.mockResolvedValue(undefined);
    mockApiActions.setSwingMode.mockResolvedValue(undefined);
    mockApiActions.cleanup.mockResolvedValue(undefined);

    deviceConfig = { name: 'Test AC', ip: '192.168.1.99', port: 7777, updateInterval: 30 };
    mockServiceInstance.getCharacteristic.mockClear();
    mockServiceInstance.setCharacteristic.mockClear();
    mockServiceInstance.characteristics.clear();

    mockAccessoryInstance = {
      context: { deviceConfig },
      displayName: deviceConfig.name,
      UUID: 'test-accessory-uuid',
      category: Categories.AIR_CONDITIONER,
      getService: jest.fn().mockReturnValue(mockServiceInstance) as any,
      addService: jest.fn().mockReturnValue(mockServiceInstance) as any,
      services: [mockServiceInstance as unknown],
      on: jest.fn(),
      emit: jest.fn(),
      removeService: jest.fn(),
      getServiceById: jest.fn(),
    } as unknown as PlatformAccessory;

    accessory = new TfiacPlatformAccessory(mockPlatform, mockAccessoryInstance);

    const testContext = accessory as unknown as TestAccessoryContext;
    if (testContext.pollingInterval) {
      clearInterval(testContext.pollingInterval);
      testContext.pollingInterval = null;
    }
    testContext.cachedStatus = { ...initialStatusFahrenheit };

    expect(AirConditionerAPI).toHaveBeenCalledWith(deviceConfig.ip, deviceConfig.port);
    expect(mockAccessoryInstance.getService).toHaveBeenCalledWith(hapIdentifiers.Service.HeaterCooler);
    expect(mockServiceInstance.setCharacteristic).toHaveBeenCalledWith(hapConstants.Characteristic.Name, deviceConfig.name);
  });

  afterEach(() => {
    const testContext = accessory as unknown as TestAccessoryContext;
    if (accessory && typeof testContext.stopPolling === 'function') {
      testContext.stopPolling();
    } else {
      mockApiActions.cleanup.mockClear();
    }
    jest.clearAllTimers();
    Object.values(mockApiActions).forEach(mockFn => mockFn.mockClear());
  });

  // --- Helper to get the registered handler ---
  const getHandlerByIdentifier = (characteristicIdentifier: string, event: 'get' | 'set'): MockCharacteristicGetHandler | MockCharacteristicSetHandler => {
    const characteristic = mockServiceInstance.characteristics.get(characteristicIdentifier);
    if (!characteristic) {
      throw new Error(`Characteristic ${characteristicIdentifier} not found/registered on mock service.`);
    }
    const handler = event === 'get' ? characteristic.getHandler : characteristic.setHandler;
    if (!handler) {
      const availableHandlers = { get: !!characteristic.getHandler, set: !!characteristic.setHandler };
      console.error(`Handler for '${event}' on characteristic '${characteristicIdentifier}' was not registered. Available:`, availableHandlers);
      throw new Error(`Handler for '${event}' on characteristic ${characteristicIdentifier} was not registered.`);
    }
    return handler;
  };

  // --- Test Cases ---
  describe('Initialization', () => {
    it('should create AirConditionerAPI instance', () => {
      expect(AirConditionerAPI).toHaveBeenCalledWith(deviceConfig.ip, deviceConfig.port);
    });
    it('should get or add HeaterCooler service and set name', () => {
      expect(mockAccessoryInstance.getService).toHaveBeenCalledWith(hapIdentifiers.Service.HeaterCooler);
      expect(mockServiceInstance.setCharacteristic).toHaveBeenCalledWith(hapConstants.Characteristic.Name, deviceConfig.name);
    });

    it('should register handlers for characteristics using identifiers', () => {
      const activeChar = mockServiceInstance.getCharacteristic(hapIdentifiers.Characteristic.Active);
      expect(activeChar.on).toHaveBeenCalledWith('get', expect.any(Function));
      expect(activeChar.on).toHaveBeenCalledWith('set', expect.any(Function));
    });

    it('should attempt initial status update via polling mechanism', () => {
      expect(mockApiActions.updateState).toBeCalled();
    });
  });

  describe('Polling', () => {
    it('should update cachedStatus periodically', async () => {
      // Use the accessory instance created in beforeEach
      const testContext = accessory as unknown as TestAccessoryContext;
      const initialStatus = { ...initialStatusFahrenheit, current_temp: 68, fan_mode: 'Auto' };
      const updatedStatusF = { ...initialStatusFahrenheit, current_temp: 72, fan_mode: 'High' };

      // Reset mock from constructor call and set initial state for test
      mockApiActions.updateState.mockClear();
      testContext.cachedStatus = initialStatus;
      // Ensure subsequent calls return the updated status
      mockApiActions.updateState.mockResolvedValue(updatedStatusF);

      const intervalMs = deviceConfig.updateInterval ? deviceConfig.updateInterval * 1000 : 30000;
      // jest.useFakeTimers(); // Already called in beforeEach

      // Advance time to trigger polling (warmup + first interval)
      jest.advanceTimersByTime(intervalMs + 500); // Add buffer for random delay
      await jest.runOnlyPendingTimersAsync(); // Ensure all async operations complete

      // Expect updateState to be called for warmup and the first interval
      // Note: The exact number might depend on the random delay implementation.
      // If the random delay is significant, it might only be called once within intervalMs + 500.
      // Adjust this expectation based on the actual polling logic. Assuming 2 calls: warmup + interval.
      expect(mockApiActions.updateState).toHaveBeenCalled();
      expect(testContext.cachedStatus).toEqual(updatedStatusF);

      // Interval clearing is handled in afterEach
      // jest.useRealTimers(); // Handled by Jest automatically or in afterEach
    });

    it('should handle API errors during polling', async () => {
      const pollError = new Error('Poll failed');
      mockApiActions.updateState
        .mockResolvedValueOnce({ ...initialStatusFahrenheit })
        .mockRejectedValue(pollError);
      accessory = new TfiacPlatformAccessory(mockPlatform, mockAccessoryInstance);
      mockApiActions.updateState.mockClear();
      const testContext = accessory as unknown as TestAccessoryContext;
      testContext.cachedStatus = { ...initialStatusFahrenheit };
      const initialCache = JSON.parse(JSON.stringify(testContext.cachedStatus));
      const intervalMs = deviceConfig.updateInterval ? deviceConfig.updateInterval * 1000 : 30000;
      jest.advanceTimersByTime(intervalMs + 500);
      await Promise.resolve();
      // updateState is now expected to be called once during this test 
      // (we already cleared the mock after initialization)
      expect(mockApiActions.updateState).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith('Error updating cached status:', pollError);
      expect(testContext.cachedStatus).toEqual(initialCache);
      if (testContext.pollingInterval) {
        clearInterval(testContext.pollingInterval); testContext.pollingInterval = null;
      }
      if (testContext.deviceAPI && testContext.deviceAPI.cleanup) {
        testContext.deviceAPI.cleanup();
      }
    }, 100);

    it('stopPolling should clear interval and call API cleanup', () => {
      const testContext = accessory as unknown as TestAccessoryContext;
      testContext.pollingInterval = setTimeout(() => {}, 50000);
      accessory.stopPolling();
      expect(testContext.pollingInterval).toBeNull();
      expect(mockLogger.debug).toHaveBeenCalledWith('Polling stopped for %s', deviceConfig.name);
      expect(mockApiActions.cleanup).toBeCalled();
    });
  });

  describe('Characteristic Handlers', () => {
    describe('Active', () => {
      it('handleActiveSet(ACTIVE) should call deviceAPI.turnOn', (done) => {
        const handler = getHandlerByIdentifier(hapIdentifiers.Characteristic.Active, 'set') as MockCharacteristicSetHandler;
        const value = hapConstants.Characteristic.Active.ACTIVE;
        const callback: CharacteristicSetCallback = (error) => {
          try {
            expect(error).toBeNull();
            expect(mockApiActions.turnOn).toBeCalled();
            expect(mockApiActions.turnOff).not.toHaveBeenCalled();
            expect(mockApiActions.updateState).toBeCalled();
            done();
          } catch (e) {
            done(e as Error);
          }
        };
        handler(value, callback);
        jest.advanceTimersByTime(1);
      });

      it('handleActiveSet(INACTIVE) should call deviceAPI.turnOff', (done) => {
        const handler = getHandlerByIdentifier(hapIdentifiers.Characteristic.Active, 'set') as MockCharacteristicSetHandler;
        const value = hapConstants.Characteristic.Active.INACTIVE;
        const callback: CharacteristicSetCallback = (error) => {
          try {
            expect(error).toBeNull();
            expect(mockApiActions.turnOff).toBeCalled();
            expect(mockApiActions.turnOn).not.toHaveBeenCalled();
            expect(mockApiActions.updateState).toBeCalled();
            done();
          } catch (e) {
            done(e as Error);
          }
        };
        handler(value, callback);
        jest.advanceTimersByTime(1);
      });

      it('handleActiveSet should handle API errors', (done) => {
        const apiError = new Error('API Failed');
        mockApiActions.turnOn.mockRejectedValueOnce(apiError);
        const handler = getHandlerByIdentifier(hapIdentifiers.Characteristic.Active, 'set') as MockCharacteristicSetHandler;
        const value = hapConstants.Characteristic.Active.ACTIVE;
        const callback: CharacteristicSetCallback = (error) => {
          try {
            expect(error).toBe(apiError);
            expect(mockApiActions.updateState).toHaveBeenCalled();
            done();
          } catch (e) {
            done(e as Error);
          }
        };
        handler(value, callback);
        jest.advanceTimersByTime(1);
      });

      it('handleActiveGet should return INACTIVE based on cache', (done) => {
        (accessory as unknown as TestAccessoryContext).cachedStatus = { ...initialStatusFahrenheit, is_on: 'off' };
        const handler = getHandlerByIdentifier(hapIdentifiers.Characteristic.Active, 'get') as MockCharacteristicGetHandler;
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull(); expect(value).toBe(hapConstants.Characteristic.Active.INACTIVE); done();
        };
        handler(callback);
      });

      it('handleActiveGet should return ACTIVE based on cache', (done) => {
        (accessory as unknown as TestAccessoryContext).cachedStatus = { ...initialStatusFahrenheit, is_on: 'on' };
        const handler = getHandlerByIdentifier(hapIdentifiers.Characteristic.Active, 'get') as MockCharacteristicGetHandler;
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull(); expect(value).toBe(hapConstants.Characteristic.Active.ACTIVE); done();
        };
        handler(callback);
      });

      it('handleActiveGet should return default value if cache is null', (done) => {
        (accessory as unknown as TestAccessoryContext).cachedStatus = null;
        const handler = getHandlerByIdentifier(hapIdentifiers.Characteristic.Active, 'get') as MockCharacteristicGetHandler;
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBe(hapConstants.Characteristic.Active.INACTIVE);
          done();
        };
        handler(callback);
      });
    });

    describe('CurrentTemperature', () => {
      it('handleCurrentTemperatureGet should return celsius value from cache', (done) => {
        const tempF = 71.6;
        (accessory as unknown as TestAccessoryContext).cachedStatus = { ...initialStatusFahrenheit, current_temp: tempF };
        const handler = getHandlerByIdentifier(hapIdentifiers.Characteristic.CurrentTemperature, 'get') as MockCharacteristicGetHandler;
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull(); expect(value).toBeCloseTo(22); done();
        };
        handler(callback);
      });

      it('handleCurrentTemperatureGet should return default value if cache null', (done) => {
        (accessory as unknown as TestAccessoryContext).cachedStatus = null;
        const handler = getHandlerByIdentifier(hapIdentifiers.Characteristic.CurrentTemperature, 'get') as MockCharacteristicGetHandler;
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull(); 
          expect(value).toBe(20); // Default value instead of error
          done();
        };
        handler(callback);
      });
    });

    describe('ThresholdTemperature', () => {
      const coolingCharId = hapIdentifiers.Characteristic.CoolingThresholdTemperature;
      const heatingCharId = hapIdentifiers.Characteristic.HeatingThresholdTemperature;

      it('handleThresholdTemperatureGet should return celsius target temp from cache', (done) => {
        const tempF = 68;
        (accessory as unknown as TestAccessoryContext).cachedStatus = { ...initialStatusFahrenheit, target_temp: tempF };
        const handler = getHandlerByIdentifier(coolingCharId, 'get') as MockCharacteristicGetHandler;
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull(); expect(value).toBeCloseTo(20); done();
        };
        handler(callback);
      });

      it('handleThresholdTemperatureSet should call API with Fahrenheit value', (done) => {
        const handler = getHandlerByIdentifier(coolingCharId, 'set') as MockCharacteristicSetHandler;
        const valueCelsius = 19;
        const expectedFahrenheit = Math.round((19 * 9/5) + 32);
        const callback: CharacteristicSetCallback = (error) => {
          try {
            expect(error).toBeNull();
            const call = mockApiActions.setAirConditionerState.mock.calls[0];
            expect(call[0]).toBe('target_temp');
            expect(Math.round(Number(call[1]))).toBe(expectedFahrenheit);
            expect(mockApiActions.updateState).toBeCalled();
            done();
          } catch (e) {
            done(e as Error);
          }
        };
        handler(valueCelsius, callback);
        jest.advanceTimersByTime(1);
      });

      it('handleThresholdTemperatureSet should handle API error', (done) => {
        const apiError = new Error('Set Temp Failed');
        mockApiActions.setAirConditionerState.mockRejectedValueOnce(apiError);
        const handler = getHandlerByIdentifier(heatingCharId, 'set') as MockCharacteristicSetHandler;
        const callback: CharacteristicSetCallback = (error) => {
          try {
            expect(error).toBe(apiError);
            expect(mockApiActions.updateState).toHaveBeenCalled();
            done();
          } catch (e) {
            done(e as Error);
          }
        };
        handler(21, callback);
        jest.advanceTimersByTime(1);
      });

      it('handleThresholdTemperatureGet should return default value if cache null', (done) => {
        (accessory as unknown as TestAccessoryContext).cachedStatus = null;
        const handler = getHandlerByIdentifier(coolingCharId, 'get') as MockCharacteristicGetHandler;
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBe(22); // Default value instead of error
          done();
        };
        handler(callback);
      });
    });

    describe('CurrentHeaterCoolerState', () => {
      it('should return COOLING based on cache mode', (done) => {
        (accessory as unknown as TestAccessoryContext).cachedStatus = { ...initialStatusFahrenheit, operation_mode: 'cool' };
        const handler = getHandlerByIdentifier(hapIdentifiers.Characteristic.CurrentHeaterCoolerState, 'get') as MockCharacteristicGetHandler;
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBe(hapConstants.Characteristic.CurrentHeaterCoolerState.COOLING);
          done();
        };
        handler(callback);
      });
      it('should return HEATING based on cache mode', (done) => {
        (accessory as unknown as TestAccessoryContext).cachedStatus = { ...initialStatusFahrenheit, operation_mode: 'heat' };
        const handler = getHandlerByIdentifier(hapIdentifiers.Characteristic.CurrentHeaterCoolerState, 'get') as MockCharacteristicGetHandler;
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBe(hapConstants.Characteristic.CurrentHeaterCoolerState.HEATING);
          done();
        };
        handler(callback);
      });
      it('should return IDLE based on cache mode', (done) => {
        (accessory as unknown as TestAccessoryContext).cachedStatus = { ...initialStatusFahrenheit, operation_mode: 'other' };
        const handler = getHandlerByIdentifier(hapIdentifiers.Characteristic.CurrentHeaterCoolerState, 'get') as MockCharacteristicGetHandler;
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBe(hapConstants.Characteristic.CurrentHeaterCoolerState.IDLE);
          done();
        };
        handler(callback);
      });
      it('should return default value if cache is null', (done) => {
        (accessory as unknown as TestAccessoryContext).cachedStatus = null;
        const handler = getHandlerByIdentifier(hapIdentifiers.Characteristic.CurrentHeaterCoolerState, 'get') as MockCharacteristicGetHandler;
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBe(hapConstants.Characteristic.CurrentHeaterCoolerState.IDLE);
          done();
        };
        handler(callback);
      });
    });

    describe('TargetHeaterCoolerState', () => {
      const charId = hapIdentifiers.Characteristic.TargetHeaterCoolerState;

      it('should return COOL based on cache mode', (done) => {
        (accessory as unknown as TestAccessoryContext).cachedStatus = { ...initialStatusFahrenheit, operation_mode: 'cool' };
        const handler = getHandlerByIdentifier(charId, 'get') as MockCharacteristicGetHandler;
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBe(hapConstants.Characteristic.TargetHeaterCoolerState.COOL);
          done();
        };
        handler(callback);
      });
      it('should return HEAT based on cache mode', (done) => {
        (accessory as unknown as TestAccessoryContext).cachedStatus = { ...initialStatusFahrenheit, operation_mode: 'heat' };
        const handler = getHandlerByIdentifier(charId, 'get') as MockCharacteristicGetHandler;
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBe(hapConstants.Characteristic.TargetHeaterCoolerState.HEAT);
          done();
        };
        handler(callback);
      });
      it('should return AUTO based on cache mode (default)', (done) => {
        (accessory as unknown as TestAccessoryContext).cachedStatus = { ...initialStatusFahrenheit, operation_mode: 'other' };
        const handler = getHandlerByIdentifier(charId, 'get') as MockCharacteristicGetHandler;
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBe(hapConstants.Characteristic.TargetHeaterCoolerState.AUTO);
          done();
        };
        handler(callback);
      });

      it('should set mode to cool via API', (done) => {
        const handler = getHandlerByIdentifier(charId, 'set') as MockCharacteristicSetHandler;
        const value = hapConstants.Characteristic.TargetHeaterCoolerState.COOL;
        const callback: CharacteristicSetCallback = (error) => {
          try {
            expect(error).toBeNull();
            expect(mockApiActions.setAirConditionerState).toHaveBeenCalledWith('operation_mode', 'cool');
            expect(mockApiActions.updateState).toBeCalled();
            done();
          } catch (e) {
            done(e as Error);
          }
        };
        handler(value, callback);
        jest.advanceTimersByTime(1);
      });

      it('should set mode to heat via API', (done) => {
        const handler = getHandlerByIdentifier(charId, 'set') as MockCharacteristicSetHandler;
        const value = hapConstants.Characteristic.TargetHeaterCoolerState.HEAT;
        const callback: CharacteristicSetCallback = (error) => {
          try {
            expect(error).toBeNull();
            expect(mockApiActions.setAirConditionerState).toHaveBeenCalledWith('operation_mode', 'heat');
            expect(mockApiActions.updateState).toBeCalled();
            done();
          } catch (e) {
            done(e as Error);
          }
        };
        handler(value, callback);
        jest.advanceTimersByTime(1);
      });

      it('should set mode to auto via API', (done) => {
        const handler = getHandlerByIdentifier(charId, 'set') as MockCharacteristicSetHandler;
        const value = hapConstants.Characteristic.TargetHeaterCoolerState.AUTO;
        const callback: CharacteristicSetCallback = (error) => {
          try {
            expect(error).toBeNull();
            expect(mockApiActions.setAirConditionerState).toHaveBeenCalledWith('operation_mode', 'auto');
            expect(mockApiActions.updateState).toBeCalled();
            done();
          } catch (e) {
            done(e as Error);
          }
        };
        handler(value, callback);
        jest.advanceTimersByTime(1);
      });

      it('should return default value if cache is null', (done) => {
        (accessory as unknown as TestAccessoryContext).cachedStatus = null;
        const handler = getHandlerByIdentifier(charId, 'get') as MockCharacteristicGetHandler;
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBe(hapConstants.Characteristic.TargetHeaterCoolerState.AUTO);
          done();
        };
        handler(callback);
      });
    });

    describe('RotationSpeed', () => {
      const charId = hapIdentifiers.Characteristic.RotationSpeed;

      it('should get speed percentage for High', (done) => {
        (accessory as unknown as TestAccessoryContext).cachedStatus = { ...initialStatusFahrenheit, fan_mode: 'High' };
        const handler = getHandlerByIdentifier(charId, 'get') as MockCharacteristicGetHandler;
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBe(75);
          done();
        };
        handler(callback);
      });
      it('should get speed percentage for Middle', (done) => {
        (accessory as unknown as TestAccessoryContext).cachedStatus = { ...initialStatusFahrenheit, fan_mode: 'Middle' };
        const handler = getHandlerByIdentifier(charId, 'get') as MockCharacteristicGetHandler;
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBe(50);
          done();
        };
        handler(callback);
      });
      it('should get speed percentage for Low', (done) => {
        (accessory as unknown as TestAccessoryContext).cachedStatus = { ...initialStatusFahrenheit, fan_mode: 'Low' };
        const handler = getHandlerByIdentifier(charId, 'get') as MockCharacteristicGetHandler;
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBe(25);
          done();
        };
        handler(callback);
      });
      it('should get speed percentage for Auto', (done) => {
        (accessory as unknown as TestAccessoryContext).cachedStatus = { ...initialStatusFahrenheit, fan_mode: 'Auto' };
        const handler = getHandlerByIdentifier(charId, 'get') as MockCharacteristicGetHandler;
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBe(50);
          done();
        };
        handler(callback);
      });

      it('should set fan mode to High based on percentage > 50', (done) => {
        const handler = getHandlerByIdentifier(charId, 'set') as MockCharacteristicSetHandler;
        const value = 60;
        const callback: CharacteristicSetCallback = (error) => {
          try {
            expect(error).toBeNull();
            expect(mockApiActions.setFanSpeed).toHaveBeenCalledWith('High');
            expect(mockApiActions.updateState).toBeCalled();
            done();
          } catch (e) {
            done(e as Error);
          }
        };
        handler(value, callback);
        jest.advanceTimersByTime(1);
      });

      it('should set fan mode to Middle based on percentage > 25 and <= 50', (done) => {
        const handler = getHandlerByIdentifier(charId, 'set') as MockCharacteristicSetHandler;
        const value = 50;
        const callback: CharacteristicSetCallback = (error) => {
          try {
            expect(error).toBeNull();
            expect(mockApiActions.setFanSpeed).toHaveBeenCalledWith('Middle');
            expect(mockApiActions.updateState).toBeCalled();
            done();
          } catch (e) {
            done(e as Error);
          }
        };
        handler(value, callback);
        jest.advanceTimersByTime(1);
      });

      it('should set fan mode to Low based on percentage <= 25', (done) => {
        const handler = getHandlerByIdentifier(charId, 'set') as MockCharacteristicSetHandler;
        const value = 20;
        const callback: CharacteristicSetCallback = (error) => {
          try {
            expect(error).toBeNull();
            expect(mockApiActions.setFanSpeed).toHaveBeenCalledWith('Low');
            expect(mockApiActions.updateState).toBeCalled();
            done();
          } catch (e) {
            done(e as Error);
          }
        };
        handler(value, callback);
        jest.advanceTimersByTime(1);
      });

      it('should set fan mode to Auto based on percentage > 75', (done) => {
        const handler = getHandlerByIdentifier(charId, 'set') as MockCharacteristicSetHandler;
        const value = 80;
        const callback: CharacteristicSetCallback = (error) => {
          try {
            expect(error).toBeNull();
            expect(mockApiActions.setFanSpeed).toHaveBeenCalledWith('Auto');
            expect(mockApiActions.updateState).toBeCalled();
            done();
          } catch (e) {
            done(e as Error);
          }
        };
        handler(value, callback);
        jest.advanceTimersByTime(1);
      });

      it('should return default value (50) if cache is null', (done) => {
        (accessory as unknown as TestAccessoryContext).cachedStatus = null;
        const handler = getHandlerByIdentifier(charId, 'get') as MockCharacteristicGetHandler;
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBe(50); // Default medium fan speed
          done();
        };
        handler(callback);
      });
    });

    describe('SwingMode', () => {
      const charId = hapIdentifiers.Characteristic.SwingMode;

      it('should get SWING_DISABLED based on cache', (done) => {
        (accessory as unknown as TestAccessoryContext).cachedStatus = { ...initialStatusFahrenheit, swing_mode: 'Off' };
        const handler = getHandlerByIdentifier(charId, 'get') as MockCharacteristicGetHandler;
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBe(0);
          done();
        };
        handler(callback);
      });
      it('should get SWING_ENABLED based on cache', (done) => {
        (accessory as unknown as TestAccessoryContext).cachedStatus = { ...initialStatusFahrenheit, swing_mode: 'Both' };
        const handler = getHandlerByIdentifier(charId, 'get') as MockCharacteristicGetHandler;
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBe(1);
          done();
        };
        handler(callback);
      });

      it('should set swing mode to Both (ENABLED)', (done) => {
        const handler = getHandlerByIdentifier(charId, 'set') as MockCharacteristicSetHandler;
        const value = hapConstants.Characteristic.SwingMode.SWING_ENABLED;
        const callback: CharacteristicSetCallback = (error) => {
          try {
            expect(error).toBeNull();
            expect(mockApiActions.setSwingMode).toHaveBeenCalledWith('Both');
            expect(mockApiActions.updateState).toBeCalled();
            done();
          } catch (e) {
            done(e as Error);
          }
        };
        handler(value, callback);
        jest.advanceTimersByTime(1);
      });

      it('should set swing mode to Off (DISABLED)', (done) => {
        const handler = getHandlerByIdentifier(charId, 'set') as MockCharacteristicSetHandler;
        const value = hapConstants.Characteristic.SwingMode.SWING_DISABLED;
        const callback: CharacteristicSetCallback = (error) => {
          try {
            expect(error).toBeNull();
            expect(mockApiActions.setSwingMode).toHaveBeenCalledWith('Off');
            expect(mockApiActions.updateState).toBeCalled();
            done();
          } catch (e) {
            done(e as Error);
          }
        };
        handler(value, callback);
        jest.advanceTimersByTime(1);
      });

      it('should return default value (SWING_DISABLED) if cache is null', (done) => {
        (accessory as unknown as TestAccessoryContext).cachedStatus = null;
        const handler = getHandlerByIdentifier(charId, 'get') as MockCharacteristicGetHandler;
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBe(hapConstants.Characteristic.SwingMode.SWING_DISABLED);
          done();
        };
        handler(callback);
      });
    });

    describe('FanMode/RotationSpeed mapping', () => {
      type MapHelpers = {
        mapFanModeToRotationSpeed: (mode: string) => number;
        mapRotationSpeedToFanMode: (speed: number) => string;
      };
      const getHelpers = (acc: TfiacPlatformAccessory): MapHelpers => ({
        mapFanModeToRotationSpeed: (acc as unknown as MapHelpers).mapFanModeToRotationSpeed.bind(acc),
        mapRotationSpeedToFanMode: (acc as unknown as MapHelpers).mapRotationSpeedToFanMode.bind(acc),
      });
      it('should map all fan modes to correct rotation speed', () => {
        const helpers = getHelpers(accessory);
        expect(helpers.mapFanModeToRotationSpeed('High')).toBe(75);
        expect(helpers.mapFanModeToRotationSpeed('Middle')).toBe(50);
        expect(helpers.mapFanModeToRotationSpeed('Low')).toBe(25);
        expect(helpers.mapFanModeToRotationSpeed('Auto')).toBe(50);
        expect(helpers.mapFanModeToRotationSpeed('Unknown')).toBe(50);
      });
      it('should map all rotation speeds to correct fan mode', () => {
        const helpers = getHelpers(accessory);
        expect(helpers.mapRotationSpeedToFanMode(10)).toBe('Low');
        expect(helpers.mapRotationSpeedToFanMode(30)).toBe('Middle');
        expect(helpers.mapRotationSpeedToFanMode(60)).toBe('High');
        expect(helpers.mapRotationSpeedToFanMode(80)).toBe('Auto');
      });
    });

  }); // End Characteristic Handlers

  describe('OutdoorTemperatureSensor', () => {
    it('should return default value when no cached status', done => {
      (accessory as unknown as TestAccessoryContext).cachedStatus = null;
      const handler = (accessory as any)
        .handleOutdoorTemperatureSensorCurrentTemperatureGet
        .bind(accessory) as MockCharacteristicGetHandler;
      const callback: CharacteristicGetCallback = (error, value) => {
        expect(error).toBeNull();
        expect(value).toBe(20); // Default value is 20°C
        done();
      };
      handler(callback);
    });

    it('should return outdoor temperature when available', done => {
      const status = { ...initialStatusFahrenheit, outdoor_temp: 77 }; // 77°F = 25°C
      (accessory as unknown as TestAccessoryContext).cachedStatus = status;
      const handler = (accessory as any)
        .handleOutdoorTemperatureSensorCurrentTemperatureGet
        .bind(accessory) as MockCharacteristicGetHandler;
      const callback: CharacteristicGetCallback = (error, value) => {
        expect(error).toBeNull();
        expect(value).toBeCloseTo(25); // Should convert F to C
        done();
      };
      handler(callback);
    });
  });

  describe('Temperature Sensor Handlers', () => {
    it('should handle outdoor temperature get with cached status', (done) => {
      const outdoorTempF = 68;
      (accessory as unknown as TestAccessoryContext).cachedStatus = { 
        ...initialStatusFahrenheit, 
        outdoor_temp: outdoorTempF 
      };
      
      const handler = (accessory as any)
        .handleOutdoorTemperatureSensorCurrentTemperatureGet
        .bind(accessory);
      
      const callback: CharacteristicGetCallback = (error, value) => {
        expect(error).toBeNull();
        expect(value).toBeCloseTo(20); // 68F = 20C
        done();
      };
      
      handler(callback);
    });

    it('should handle outdoor temperature get with no cached status', (done) => {
      (accessory as unknown as TestAccessoryContext).cachedStatus = null;
      
      const handler = (accessory as any)
        .handleOutdoorTemperatureSensorCurrentTemperatureGet
        .bind(accessory);
      
      const callback: CharacteristicGetCallback = (error, value) => {
        expect(error).toBeNull();
        expect(value).toBe(20); // Default value
        done();
      };
      
      handler(callback);
    });

    it('should handle outdoor temperature get with undefined outdoor_temp', (done) => {
      (accessory as unknown as TestAccessoryContext).cachedStatus = { 
        ...initialStatusFahrenheit,
        outdoor_temp: undefined
      };
      
      const handler = (accessory as any)
        .handleOutdoorTemperatureSensorCurrentTemperatureGet
        .bind(accessory);
      
      const callback: CharacteristicGetCallback = (error, value) => {
        expect(error).toBeNull();
        expect(value).toBe(20); // Default value
        done();
      };
      
      handler(callback);
    });

    // New tests for Temperature Sensor Handlers that properly bind to the accessory
    describe('Temperature Sensor Handlers', () => {
      it('should handle indoor temperature get with cached status', (done) => {
        const indoorTempF = 68;
        (accessory as unknown as TestAccessoryContext).cachedStatus = { 
          ...initialStatusFahrenheit, 
          current_temp: indoorTempF 
        };
        
        const handler = (accessory as any)
          .handleTemperatureSensorCurrentTemperatureGet
          .bind(accessory);
        
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBeCloseTo(20); // 68F = 20C
          done();
        };
        
        handler(callback);
      });

      it('should handle indoor temperature get with no cached status', (done) => {
        (accessory as unknown as TestAccessoryContext).cachedStatus = null;
        
        const handler = (accessory as any)
          .handleTemperatureSensorCurrentTemperatureGet
          .bind(accessory);
        
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBe(20); // Default value
          done();
        };
        
        handler(callback);
      });
    });
  });

  describe('Utility Methods', () => {
    let helperMethods: any;

    beforeEach(() => {
      helperMethods = accessory as any;
    });

    describe('Temperature Conversion', () => {
      it('should convert from Fahrenheit to Celsius correctly', () => {
        expect(helperMethods.fahrenheitToCelsius(32)).toBeCloseTo(0);
        expect(helperMethods.fahrenheitToCelsius(77)).toBeCloseTo(25);
        expect(helperMethods.fahrenheitToCelsius(212)).toBeCloseTo(100);
      });

      it('should convert from Celsius to Fahrenheit correctly', () => {
        expect(helperMethods.celsiusToFahrenheit(0)).toBeCloseTo(32);
        expect(helperMethods.celsiusToFahrenheit(25)).toBeCloseTo(77);
        expect(helperMethods.celsiusToFahrenheit(100)).toBeCloseTo(212);
      });
    });
  });

  describe('Utility Functions', () => {
    describe('celsiusToFahrenheit', () => {
      it('should convert celsius to fahrenheit', () => {
        expect((accessory as any).celsiusToFahrenheit(0)).toBe(32);
        expect((accessory as any).celsiusToFahrenheit(10)).toBe(50);
        expect((accessory as any).celsiusToFahrenheit(20)).toBe(68);
        expect((accessory as any).celsiusToFahrenheit(37.5)).toBe(99.5);
      });
    });

    describe('fahrenheitToCelsius', () => {
      it('should convert fahrenheit to celsius', () => {
        expect((accessory as any).fahrenheitToCelsius(32)).toBe(0);
        expect((accessory as any).fahrenheitToCelsius(50)).toBe(10);
        expect((accessory as any).fahrenheitToCelsius(68)).toBe(20);
        expect((accessory as any).fahrenheitToCelsius(99.5)).toBe(37.5);
      });
    });

    describe('convertTemperatureToDisplay', () => {
      it('should convert from celsius to fahrenheit when displayUnits is FAHRENHEIT', () => {
        const result = (accessory as any).convertTemperatureToDisplay(
          25, 
          (accessory as any).platform.api.hap.Characteristic.TemperatureDisplayUnits.FAHRENHEIT
        );
        expect(result).toBe(77);
      });

      it('should return the same value when displayUnits is CELSIUS', () => {
        const result = (accessory as any).convertTemperatureToDisplay(
          25, 
          (accessory as any).platform.api.hap.Characteristic.TemperatureDisplayUnits.CELSIUS
        );
        expect(result).toBe(25);
      });
    });

    describe('convertTemperatureFromDisplay', () => {
      it('should convert from fahrenheit to celsius when displayUnits is FAHRENHEIT', () => {
        const result = (accessory as any).convertTemperatureFromDisplay(
          77, 
          (accessory as any).platform.api.hap.Characteristic.TemperatureDisplayUnits.FAHRENHEIT
        );
        expect(result).toBe(25);
      });

      it('should return the same value when displayUnits is CELSIUS', () => {
        const result = (accessory as any).convertTemperatureFromDisplay(
          25, 
          (accessory as any).platform.api.hap.Characteristic.TemperatureDisplayUnits.CELSIUS
        );
        expect(result).toBe(25);
      });
    });
    
    describe('mapHomebridgeModeToAPIMode', () => {
      it('should map AUTO correctly', () => {
        const result = (accessory as any).mapHomebridgeModeToAPIMode(
          (accessory as any).platform.api.hap.Characteristic.TargetHeaterCoolerState.AUTO
        );
        expect(result).toBe('auto');
      });

      it('should map HEAT correctly', () => {
        const result = (accessory as any).mapHomebridgeModeToAPIMode(
          (accessory as any).platform.api.hap.Characteristic.TargetHeaterCoolerState.HEAT
        );
        expect(result).toBe('heat');
      });

      it('should map COOL correctly', () => {
        const result = (accessory as any).mapHomebridgeModeToAPIMode(
          (accessory as any).platform.api.hap.Characteristic.TargetHeaterCoolerState.COOL
        );
        expect(result).toBe('cool');
      });

      it('should map dry to cool', () => {
        const result = (accessory as any).mapAPIModeToHomebridgeMode('dry');
        expect(result).toBe(
          (accessory as any).platform.api.hap.Characteristic.TargetHeaterCoolerState.COOL
        );
      });

      it('should map fan to auto', () => {
        const result = (accessory as any).mapAPIModeToHomebridgeMode('fan');
        expect(result).toBe(
          (accessory as any).platform.api.hap.Characteristic.TargetHeaterCoolerState.AUTO
        );
      });

      it('should return AUTO for unknown values', () => {
        const result = (accessory as any).mapAPIModeToHomebridgeMode('unknown');
        expect(result).toBe(
          (accessory as any).platform.api.hap.Characteristic.TargetHeaterCoolerState.AUTO
        );
      });
    });

    describe('mapAPIModeToHomebridgeMode', () => {
      it('should map auto correctly', () => {
        const result = (accessory as any).mapAPIModeToHomebridgeMode('auto');
        expect(result).toBe(
          (accessory as any).platform.api.hap.Characteristic.TargetHeaterCoolerState.AUTO
        );
      });

      it('should map heat correctly', () => {
        const result = (accessory as any).mapAPIModeToHomebridgeMode('heat');
        expect(result).toBe(
          (accessory as any).platform.api.hap.Characteristic.TargetHeaterCoolerState.HEAT
        );
      });

      it('should map cool correctly', () => {
        const result = (accessory as any).mapAPIModeToHomebridgeMode('cool');
        expect(result).toBe(
          (accessory as any).platform.api.hap.Characteristic.TargetHeaterCoolerState.COOL
        );
      });
    });
    
    describe('mapAPIActiveToHomebridgeActive', () => {
      it('should map on to ACTIVE', () => {
        const result = (accessory as any).mapAPIActiveToHomebridgeActive('on');
        expect(result).toBe(
          (accessory as any).platform.api.hap.Characteristic.Active.ACTIVE
        );
      });

      it('should map off to INACTIVE', () => {
        const result = (accessory as any).mapAPIActiveToHomebridgeActive('off');
        expect(result).toBe(
          (accessory as any).platform.api.hap.Characteristic.Active.INACTIVE
        );
      });

      it('should return INACTIVE for unknown values', () => {
        const result = (accessory as any).mapAPIActiveToHomebridgeActive('unknown');
        expect(result).toBe(
          (accessory as any).platform.api.hap.Characteristic.Active.INACTIVE
        );
      });
    });

    describe('mapAPICurrentModeToHomebridgeCurrentMode', () => {
      it('should map heat to HEATING', () => {
        const result = (accessory as any).mapAPICurrentModeToHomebridgeCurrentMode('heat');
        expect(result).toBe(
          (accessory as any).platform.api.hap.Characteristic.CurrentHeaterCoolerState.HEATING
        );
      });

      it('should map cool to COOLING', () => {
        const result = (accessory as any).mapAPICurrentModeToHomebridgeCurrentMode('cool');
        expect(result).toBe(
          (accessory as any).platform.api.hap.Characteristic.CurrentHeaterCoolerState.COOLING
        );
      });

      it('should map auto to IDLE when powerState is off', () => {
        const result = (accessory as any).mapAPICurrentModeToHomebridgeCurrentMode('auto', 'off');
        expect(result).toBe(
          (accessory as any).platform.api.hap.Characteristic.CurrentHeaterCoolerState.IDLE
        );
      });

      it('should map auto to IDLE when powerState is unknown', () => {
        const result = (accessory as any).mapAPICurrentModeToHomebridgeCurrentMode('auto', 'unknown');
        expect(result).toBe(
          (accessory as any).platform.api.hap.Characteristic.CurrentHeaterCoolerState.IDLE
        );
      });

      it('should map auto to HEATING when targetTemp > currentTemp and powerState is on', () => {
        const result = (accessory as any).mapAPICurrentModeToHomebridgeCurrentMode('auto', 'on', 25, 20);
        expect(result).toBe(
          (accessory as any).platform.api.hap.Characteristic.CurrentHeaterCoolerState.HEATING
        );
      });

      it('should map auto to COOLING when targetTemp < currentTemp and powerState is on', () => {
        const result = (accessory as any).mapAPICurrentModeToHomebridgeCurrentMode('auto', 'on', 20, 25);
        expect(result).toBe(
          (accessory as any).platform.api.hap.Characteristic.CurrentHeaterCoolerState.COOLING
        );
      });

      it('should map auto to IDLE when targetTemp = currentTemp and powerState is on', () => {
        const result = (accessory as any).mapAPICurrentModeToHomebridgeCurrentMode('auto', 'on', 25, 25);
        expect(result).toBe(
          (accessory as any).platform.api.hap.Characteristic.CurrentHeaterCoolerState.IDLE
        );
      });

      it('should handle dry mode as COOLING', () => {
        const result = (accessory as any).mapAPICurrentModeToHomebridgeCurrentMode('dry', 'on');
        expect(result).toBe(
          (accessory as any).platform.api.hap.Characteristic.CurrentHeaterCoolerState.COOLING
        );
      });

      it('should handle fan mode as IDLE', () => {
        const result = (accessory as any).mapAPICurrentModeToHomebridgeCurrentMode('fan', 'on');
        expect(result).toBe(
          (accessory as any).platform.api.hap.Characteristic.CurrentHeaterCoolerState.IDLE
        );
      });

      it('should return IDLE for unknown values', () => {
        const result = (accessory as any).mapAPICurrentModeToHomebridgeCurrentMode('unknown');
        expect(result).toBe(
          (accessory as any).platform.api.hap.Characteristic.CurrentHeaterCoolerState.IDLE
        );
      });
    });
  });

  describe('Constructor and Initialization', () => {
    it('should initialize with temperature sensor disabled', () => {
      // Create a new accessory with enableTemperature set to false
      const deviceConfigWithTempDisabled = {
        ...deviceConfig,
        enableTemperature: false
      };
      
      mockAccessoryInstance.context.deviceConfig = deviceConfigWithTempDisabled;
      const existingTempService = createMockService();
      mockAccessoryInstance.services = [existingTempService];
      
      // Mock services filtering by UUID
      mockAccessoryInstance.services.filter = jest.fn().mockReturnValue([existingTempService]);
      
      mockAccessoryInstance.getService = jest.fn().mockImplementation((service) => {
        if (service === hapIdentifiers.Service.TemperatureSensor) {
          return existingTempService;
        }
        return mockServiceInstance;
      });
      
      mockAccessoryInstance.removeService = jest.fn();
      
      // Create accessory with temperature sensor disabled
      const newAccessory = new TfiacPlatformAccessory(mockPlatform, mockAccessoryInstance);
      
      // Verify the temperature sensor was removed
      expect(mockAccessoryInstance.removeService).toHaveBeenCalledWith(existingTempService);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Temperature sensor is disabled'));
    });
    
    it('should handle outdoor temperature in cached status updates', async () => {
      // Set up mock for updateState to return a status with outdoor_temp
      const statusWithOutdoorTemp = {
        ...initialStatusFahrenheit,
        outdoor_temp: 59 // about 15°C
      };
      mockApiActions.updateState.mockResolvedValueOnce(statusWithOutdoorTemp);
      
      // Create a new accessory
      const newAccessory = new TfiacPlatformAccessory(mockPlatform, mockAccessoryInstance);
      
      // Mock the accessory.getService and addService for outdoor temperature
      const outdoorTempService = createMockService();
      mockAccessoryInstance.getService = (jest.fn().mockImplementation((serviceName: any) => {
        if (serviceName === 'Outdoor Temperature') {
          return null; // First call will return null to trigger addService
        }
        return mockServiceInstance;
      })) as unknown as PlatformAccessory['getService'];
      
      mockAccessoryInstance.addService = (jest.fn().mockImplementation((service, name) => {
        if (name === 'Outdoor Temperature') {
          return outdoorTempService;
        }
        return mockServiceInstance;
      })) as unknown as PlatformAccessory['addService'];
      
      // Call updateCachedStatus directly
      await (newAccessory as any).updateCachedStatus();
      
      // Verify the outdoor temperature service was added
      expect(mockAccessoryInstance.addService).toHaveBeenCalledWith(
        hapIdentifiers.Service.TemperatureSensor,
        'Outdoor Temperature'
      );
    });
    
    it('should remove outdoor temperature service when outdoor_temp is 0', async () => {
      // First setup a cached status with outdoor_temp
      (accessory as any).cachedStatus = {
        ...initialStatusFahrenheit,
        outdoor_temp: 59 // about 15°C
      };
      (accessory as any).outdoorTemperatureSensorService = mockServiceInstance;
      
      // Then mock updateState to return a status with outdoor_temp = 0
      const statusWithZeroOutdoorTemp = {
        ...initialStatusFahrenheit,
        outdoor_temp: 0
      };
      mockApiActions.updateState.mockResolvedValueOnce(statusWithZeroOutdoorTemp);
      
      // Call updateCachedStatus directly
      await (accessory as any).updateCachedStatus();
      
      // Verify the outdoor temperature service was removed
      expect(mockAccessoryInstance.removeService).toHaveBeenCalledWith(mockServiceInstance);
      expect((accessory as any).outdoorTemperatureSensorService).toBeNull();
    });
    
    it('should remove outdoor temperature service when outdoor_temp is NaN', async () => {
      // First setup a cached status with outdoor_temp
      (accessory as any).cachedStatus = {
        ...initialStatusFahrenheit,
        outdoor_temp: 59 // about 15°C
      };
      (accessory as any).outdoorTemperatureSensorService = mockServiceInstance;
      
      // Then mock updateState to return a status with outdoor_temp = NaN
      const statusWithNaNOutdoorTemp = {
        ...initialStatusFahrenheit,
        outdoor_temp: NaN
      };
      mockApiActions.updateState.mockResolvedValueOnce(statusWithNaNOutdoorTemp);
      
      // Call updateCachedStatus directly
      await (accessory as any).updateCachedStatus();
      
      // Verify the outdoor temperature service was removed
      expect(mockAccessoryInstance.removeService).toHaveBeenCalledWith(mockServiceInstance);
      expect((accessory as any).outdoorTemperatureSensorService).toBeNull();
    });

    it('should not add outdoor temperature service when outdoor_temp is undefined', async () => {
      // Setup a status with undefined outdoor_temp
      const statusWithoutOutdoorTemp = {
        ...initialStatusFahrenheit,
        outdoor_temp: undefined
      };
      mockApiActions.updateState.mockResolvedValueOnce(statusWithoutOutdoorTemp);
      
      // Create a new accessory
      const newAccessory = new TfiacPlatformAccessory(mockPlatform, mockAccessoryInstance);
      
      // Mock the accessory methods
      mockAccessoryInstance.getService = (jest.fn().mockReturnValue(null)) as unknown as PlatformAccessory['getService'];
      mockAccessoryInstance.addService = (jest.fn().mockReturnValue(mockServiceInstance)) as unknown as PlatformAccessory['addService'];
      
      // Reset the mock for cleanup
      (newAccessory as any).outdoorTemperatureSensorService = null;
      
      // Call updateCachedStatus directly
      await (newAccessory as any).updateCachedStatus();
      
      // Verify the outdoor temperature service was not added
      expect(mockAccessoryInstance.addService).not.toHaveBeenCalledWith(
        hapIdentifiers.Service.TemperatureSensor,
        'Outdoor Temperature'
      );
      expect((newAccessory as any).outdoorTemperatureSensorService).toBeNull();
    });

    it('should handle existing outdoor temperature service when updating cached status', async () => {
      // Setup with existing outdoor temperature service
      const outdoorTempService = createMockService();
      (accessory as any).outdoorTemperatureSensorService = outdoorTempService;
      
      // Mock updateState to return status with outdoor_temp
      const statusWithOutdoorTemp = {
        ...initialStatusFahrenheit,
        outdoor_temp: 59 // about 15°C
      };
      mockApiActions.updateState.mockResolvedValueOnce(statusWithOutdoorTemp);
      
      // Call updateCachedStatus directly
      await (accessory as any).updateCachedStatus();
      
      // Verify the outdoor temperature service was updated with the new value
      const updateCharacteristicCalls = outdoorTempService.updateCharacteristic.mock.calls;
      const lastUpdateCall = updateCharacteristicCalls[updateCharacteristicCalls.length - 1];
      
      expect(lastUpdateCall[0]).toBe(hapConstants.Characteristic.CurrentTemperature);
      expect(lastUpdateCall[1]).toBeCloseTo(15); // 59F ≈ 15C
    });
    
    it('should update indoor temperature sensor from cached status', async () => {
      // Create a mock for the temperature sensor service
      const tempSensorService = createMockService();
      (accessory as any).temperatureSensorService = tempSensorService;
      
      // Mock updateState to return status with current_temp
      const statusWithCurrentTemp = {
        ...initialStatusFahrenheit,
        current_temp: 77 // 25°C
      };
      mockApiActions.updateState.mockResolvedValueOnce(statusWithCurrentTemp);
      
      // Call updateCachedStatus directly
      await (accessory as any).updateCachedStatus();
      
      // Verify the temperature sensor service was updated with the new value
      expect(tempSensorService.updateCharacteristic).toHaveBeenCalledWith(
        hapConstants.Characteristic.CurrentTemperature,
        25 // 77F -> 25C
      );
    });
  });

  describe('Handler Error Handling', () => {
    it('should handle API errors in handleTargetHeaterCoolerStateSet', (done) => {
      // Simulate API error
      const apiError = new Error('API Error');
      mockApiActions.setAirConditionerState.mockRejectedValueOnce(apiError);
      
      const handler = getHandlerByIdentifier(hapIdentifiers.Characteristic.TargetHeaterCoolerState, 'set') as MockCharacteristicSetHandler;
      
      // Call the handler
      handler(hapConstants.Characteristic.TargetHeaterCoolerState.COOL, (error) => {
        expect(error).toBe(apiError);
        expect(mockLogger.error).toHaveBeenCalledWith(
          'Error setting TargetHeaterCoolerState:',
          apiError
        );
        done();
      });
    });
    
    it('should handle API errors in handleRotationSpeedSet', (done) => {
      // Simulate API error
      const apiError = new Error('API Error');
      mockApiActions.setFanSpeed.mockRejectedValueOnce(apiError);
      
      const handler = getHandlerByIdentifier(hapIdentifiers.Characteristic.RotationSpeed, 'set') as MockCharacteristicSetHandler;
      
      // Call the handler
      handler(50, (error) => {
        expect(error).toBe(apiError);
        expect(mockLogger.error).toHaveBeenCalledWith(
          'Error setting fan speed:',
          apiError
        );
        done();
      });
    });
    
    it('should handle API errors in handleSwingModeSet', (done) => {
      // Simulate API error
      const apiError = new Error('API Error');
      mockApiActions.setSwingMode.mockRejectedValueOnce(apiError);
      
      const handler = getHandlerByIdentifier(hapIdentifiers.Characteristic.SwingMode, 'set') as MockCharacteristicSetHandler;
      
      // Call the handler
      handler(hapConstants.Characteristic.SwingMode.SWING_ENABLED, (error) => {
        expect(error).toBe(apiError);
        expect(mockLogger.error).toHaveBeenCalledWith(
          'Error setting swing mode:',
          apiError
        );
        done();
      });
    });
    
    it('should handle API errors in handleTurboSet', (done) => {
      // Setup Turbo Switch Service with handlers
      const turboCharacteristic = (accessory as any)
        .turboService.getCharacteristic('On');
      const turboSetHandler = turboCharacteristic.setHandler;
      
      // Simulate API error
      const apiError = new Error('API Error');
      mockApiActions.setTurboState = jest.fn().mockRejectedValueOnce(apiError);
      
      // Call the handler
      turboSetHandler(true, (error) => {
        expect(error).toBe(apiError);
        expect(mockLogger.error).toHaveBeenCalledWith(
          'Error setting Turbo state:',
          apiError
        );
        done();
      });
    });
  });

  describe('Temperature Display Units Conversion', () => {
    it('should convert temperatures from Celsius to Fahrenheit for display', () => {
      const tempDisplayUnits = (accessory as any).platform.api.hap.Characteristic.TemperatureDisplayUnits;
      
      // Test with FAHRENHEIT display units
      const celsius = 25;
      const fahrenheit = (accessory as any).convertTemperatureToDisplay(celsius, tempDisplayUnits.FAHRENHEIT);
      expect(fahrenheit).toBeCloseTo(77);
      
      // Test with CELSIUS display units (no conversion)
      const noConversion = (accessory as any).convertTemperatureToDisplay(celsius, tempDisplayUnits.CELSIUS);
      expect(noConversion).toBe(celsius);
    });
    
    it('should convert temperatures from display units to Celsius', () => {
      const tempDisplayUnits = (accessory as any).platform.api.hap.Characteristic.TemperatureDisplayUnits;
      
      // Test with FAHRENHEIT display units
      const fahrenheit = 77;
      const celsius = (accessory as any).convertTemperatureFromDisplay(fahrenheit, tempDisplayUnits.FAHRENHEIT);
      expect(celsius).toBeCloseTo(25);
      
      // Test with CELSIUS display units (no conversion)
      const noConversion = (accessory as any).convertTemperatureFromDisplay(25, tempDisplayUnits.CELSIUS);
      expect(noConversion).toBe(25);
    });
  });

  describe('Turbo Switch Handlers', () => {
    it('should handle turbo get with cached status showing turbo on', (done) => {
      // Set cached status with turbo on
      (accessory as any).cachedStatus = {
        ...initialStatusFahrenheit,
        opt_super: 'on'
      };
      
      // Get the handler by accessing it directly from the accessory
      const handler = (accessory as any).handleTurboGet.bind(accessory);
      
      // Call the handler
      handler((error, value) => {
        expect(error).toBeNull();
        expect(value).toBe(true);
        done();
      });
    });
    
    it('should handle turbo get with cached status showing turbo off', (done) => {
      // Set cached status with turbo off
      (accessory as any).cachedStatus = {
        ...initialStatusFahrenheit,
        opt_super: 'off'
      };
      
      // Get the handler by accessing it directly from the accessory
      const handler = (accessory as any).handleTurboGet.bind(accessory);
      
      // Call the handler
      handler((error, value) => {
        expect(error).toBeNull();
        expect(value).toBe(false);
        done();
      });
    });
    
    it('should handle turbo get with cached status not containing opt_super', (done) => {
      // Set cached status without opt_super
      (accessory as any).cachedStatus = {
        ...initialStatusFahrenheit,
        // No opt_super property
      };
      
      // Get the handler by accessing it directly from the accessory
      const handler = (accessory as any).handleTurboGet.bind(accessory);
      
      // Call the handler
      handler((error, value) => {
        expect(error).toBeNull();
        expect(value).toBe(false); // Default is false
        done();
      });
    });
    
    it('should handle turbo get with no cached status', (done) => {
      // Set cached status to null
      (accessory as any).cachedStatus = null;
      
      // Get the handler by accessing it directly from the accessory
      const handler = (accessory as any).handleTurboGet.bind(accessory);
      
      // Call the handler
      handler((error, value) => {
        expect(error).toBeNull();
        expect(value).toBe(false); // Default is false
        done();
      });
    });
    
    it('should handle turbo set to on', (done) => {
      // Mock setTurboState to resolve
      mockApiActions.setTurboState = jest.fn().mockResolvedValue(undefined);
      
      // Get the handler by accessing it directly from the accessory
      const handler = (accessory as any).handleTurboSet.bind(accessory);
      
      // Call the handler
      handler(true, (error) => {
        expect(error).toBeNull();
        expect(mockApiActions.setTurboState).toHaveBeenCalledWith('on');
        done();
      });
    });
    
    it('should handle turbo set to off', (done) => {
      // Mock setTurboState to resolve
      mockApiActions.setTurboState = jest.fn().mockResolvedValue(undefined);
      
      // Get the handler by accessing it directly from the accessory
      const handler = (accessory as any).handleTurboSet.bind(accessory);
      
      // Call the handler
      handler(false, (error) => {
        expect(error).toBeNull();
        expect(mockApiActions.setTurboState).toHaveBeenCalledWith('off');
        done();
      });
    });
  });

  // This section tests coverage for the stopPolling function
  describe('Polling Management', () => {
    it('should handle stopPolling when deviceAPI is undefined', () => {
      // Create a new accessory
      const newAccessory = new TfiacPlatformAccessory(mockPlatform, mockAccessoryInstance);
      
      // Set deviceAPI to undefined
      (newAccessory as any).deviceAPI = undefined;
      
      // This should not throw an error
      expect(() => newAccessory.stopPolling()).not.toThrow();
    });
    
    it('should handle stopPolling when pollingInterval is not set', () => {
      // Create a new accessory
      const newAccessory = new TfiacPlatformAccessory(mockPlatform, mockAccessoryInstance);
      
      // Set pollingInterval to null
      (newAccessory as any).pollingInterval = null;
      
      // This should not throw an error and should still call cleanup
      newAccessory.stopPolling();
      expect(mockApiActions.cleanup).toHaveBeenCalled();
    });
  });
});