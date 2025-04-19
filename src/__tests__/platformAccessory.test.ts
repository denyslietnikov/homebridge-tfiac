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
} from 'homebridge';
import { TfiacPlatform } from '../platform';
import { TfiacPlatformAccessory } from '../platformAccessory';
import AirConditionerAPI, { AirConditionerStatus } from '../AirConditionerAPI';
import { TfiacDeviceConfig } from '../settings';
import { jest, describe, beforeEach, afterEach, it, expect, beforeAll } from '@jest/globals';

// --- Mock AirConditionerAPI ---

const mockApiActions = {
  updateState: jest.fn<() => Promise<AirConditionerStatus>>(),
  turnOn: jest.fn<() => Promise<void>>(),
  turnOff: jest.fn<() => Promise<void>>(),
  setAirConditionerState: jest.fn<(key: string, value: string | number) => Promise<void>>(),
  setFanSpeed: jest.fn<(value: string) => Promise<void>>(),
  setSwingMode: jest.fn<(value: string) => Promise<void>>(),
  cleanup: jest.fn<() => Promise<void>>(),
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
const createMockService = (): MockService => {
  const characteristics = new Map<string, MockCharacteristic>();
  const mockSvc: MockService = {
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
  };
  return mockSvc;
};

// --- Mock Homebridge HAP Definitions ---
const hapIdentifiers = {
  Service: { HeaterCooler: 'HeaterCooler' },
  Characteristic: {
    Name: 'Name',
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
      getService: jest.fn().mockReturnValue(mockServiceInstance),
      addService: jest.fn().mockReturnValue(mockServiceInstance),
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
      const updatedStatusF = toFahrenheit({ ...initialStatusCelsius, is_on: 'on' });
      mockApiActions.updateState
        .mockResolvedValueOnce({ ...initialStatusFahrenheit })
        .mockResolvedValue(updatedStatusF);
      accessory = new TfiacPlatformAccessory(mockPlatform, mockAccessoryInstance);
      mockApiActions.updateState.mockClear();
      const testContext = accessory as unknown as TestAccessoryContext;
      const intervalMs = deviceConfig.updateInterval ? deviceConfig.updateInterval * 1000 : 30000;
      jest.advanceTimersByTime(intervalMs + 500);
      await Promise.resolve();
      expect(mockApiActions.updateState).toHaveBeenCalledTimes(1);
      expect(testContext.cachedStatus).toEqual(updatedStatusF);
      if (testContext.pollingInterval) {
        clearInterval(testContext.pollingInterval); testContext.pollingInterval = null;
      }
      if (testContext.deviceAPI && testContext.deviceAPI.cleanup) {
        testContext.deviceAPI.cleanup();
      }
    }, 100);

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
      expect(mockApiActions.updateState).toHaveBeenCalledTimes(1);
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

      it('handleActiveGet should return error if cache is null', (done) => {
        (accessory as unknown as TestAccessoryContext).cachedStatus = null;
        const handler = getHandlerByIdentifier(hapIdentifiers.Characteristic.Active, 'get') as MockCharacteristicGetHandler;
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeInstanceOf(Error); if (error instanceof Error) {
            expect(error.message).toContain('Cached status not available');
          } expect(value).toBeUndefined(); done();
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

      it('handleCurrentTemperatureGet should return error if cache null', (done) => {
        (accessory as unknown as TestAccessoryContext).cachedStatus = null;
        const handler = getHandlerByIdentifier(hapIdentifiers.Characteristic.CurrentTemperature, 'get') as MockCharacteristicGetHandler;
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeInstanceOf(Error); expect(value).toBeUndefined(); done();
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

      it('handleThresholdTemperatureGet should return error if cache null', (done) => {
        (accessory as unknown as TestAccessoryContext).cachedStatus = null;
        const handler = getHandlerByIdentifier(coolingCharId, 'get') as MockCharacteristicGetHandler;
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeInstanceOf(Error);
          expect(value).toBeUndefined();
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
      it('should return error if cache is null', (done) => {
        (accessory as unknown as TestAccessoryContext).cachedStatus = null;
        const handler = getHandlerByIdentifier(hapIdentifiers.Characteristic.CurrentHeaterCoolerState, 'get') as MockCharacteristicGetHandler;
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeInstanceOf(Error);
          expect(value).toBeUndefined();
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

      it('should return error if cache is null', (done) => {
        (accessory as unknown as TestAccessoryContext).cachedStatus = null;
        const handler = getHandlerByIdentifier(charId, 'get') as MockCharacteristicGetHandler;
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeInstanceOf(Error);
          expect(value).toBeUndefined();
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

      it('should return error if cache is null', (done) => {
        (accessory as unknown as TestAccessoryContext).cachedStatus = null;
        const handler = getHandlerByIdentifier(charId, 'get') as MockCharacteristicGetHandler;
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeInstanceOf(Error);
          expect(value).toBeUndefined();
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

      it('should return error if cache is null', (done) => {
        (accessory as unknown as TestAccessoryContext).cachedStatus = null;
        const handler = getHandlerByIdentifier(charId, 'get') as MockCharacteristicGetHandler;
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeInstanceOf(Error);
          expect(value).toBeUndefined();
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

}); // End TfiacPlatformAccessory Suite