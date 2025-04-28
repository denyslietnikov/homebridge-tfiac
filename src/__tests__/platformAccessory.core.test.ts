// @ts-nocheck
// platformAccessory.core.test.ts

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
import { TfiacPlatform } from '../platform.js';
import { TfiacPlatformAccessory } from '../platformAccessory.js';
import AirConditionerAPI, { AirConditionerStatus } from '../AirConditionerAPI.js';
import { TfiacDeviceConfig } from '../settings.js';
import { jest, describe, beforeEach, afterEach, it, expect, beforeAll } from '@jest/globals';

// --- Mock AirConditionerAPI ---

export const mockApiActions = {
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
export const hapIdentifiers = {
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

export const hapConstants = {
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
export const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  success: jest.fn(),
  log: jest.fn(),
  prefix: '',
};

export const mockPlatform = {
  log: mockLogger,
  api: { hap: { Service: hapIdentifiers.Service, Characteristic: hapConstants.Characteristic } } as unknown as API,
  Service: hapIdentifiers.Service,
  Characteristic: hapConstants.Characteristic,
} as unknown as TfiacPlatform;

// --- Initial Status Data ---
export const initialStatusCelsius: AirConditionerStatus = {
  is_on: 'off',
  current_temp: 22,
  target_temp: 20,
  operation_mode: 'cool',
  fan_mode: 'Auto',
  swing_mode: 'Off',
};

export const toFahrenheit = (status: AirConditionerStatus): AirConditionerStatus => ({
  ...status,
  current_temp: Math.round((status.current_temp * 9/5) + 32),
  target_temp: Math.round((status.target_temp * 9/5) + 32),
});

export const initialStatusFahrenheit = toFahrenheit(initialStatusCelsius);

// Helper type for test context
interface TestAccessoryContext {
  pollingInterval: NodeJS.Timeout | null;
  cachedStatus: AirConditionerStatus | null;
  deviceAPI?: { cleanup?: () => void };
  stopPolling?: () => void;
}

// --- Test Helpers ---

// Helper to get the registered handler - Updated for new implementation
export const getHandlerByIdentifier = (
  service: any,
  characteristicIdentifier: string, 
  event: 'get' | 'set'
): MockCharacteristicGetHandler | MockCharacteristicSetHandler => {
  // Try using the new method first if this is an accessory instance
  if (service && service.getCharacteristicHandler && typeof service.getCharacteristicHandler === 'function') {
    const handler = service.getCharacteristicHandler(characteristicIdentifier, event);
    
    if (handler) {
      return handler as MockCharacteristicGetHandler | MockCharacteristicSetHandler;
    }
  }
  
  // Fall back to looking in the service characteristics for backwards compatibility
  if (service && service.characteristics && service.characteristics.get) {
    const char = service.characteristics.get(characteristicIdentifier);
    if (char) {
      return event === 'get' ? char.getHandler! : char.setHandler!;
    }
  }
  
  throw new Error(`Handler for '${event}' on characteristic ${characteristicIdentifier} was not found.`);
};

// --- The Core Test Suite ---
describe('TfiacPlatformAccessory - Core', () => {
  let accessory: TfiacPlatformAccessory;
  let deviceConfig: TfiacDeviceConfig;
  let mockAccessoryInstance: PlatformAccessory;
  let mockServiceInstance: any;

  beforeAll(() => {
    jest.setTimeout(30000); // Increase timeout to 30 seconds for all tests in this suite
  });

  beforeEach(() => {
    jest.useFakeTimers();
    mockServiceInstance = createMockService();
    
    // Clear all mocks before each test
    Object.values(mockApiActions).forEach(mockFn => mockFn.mockClear());
    // Reset the AirConditionerAPI constructor mock
    (AirConditionerAPI as jest.Mock).mockClear();
    // Update how we reset the logger mocks
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    mockLogger.debug.mockClear();
    mockLogger.success.mockClear();
    mockLogger.log.mockClear();

    // Set up mock return values
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

    // Create the accessory - IMPORTANT: this needs to happen after the mocks are set up
    accessory = new TfiacPlatformAccessory(mockPlatform, mockAccessoryInstance);
    
    // Manually set deviceAPI to our mock to ensure API calls work
    (accessory as any).deviceAPI = mockApiActions;

    const testContext = accessory as unknown as TestAccessoryContext;
    if (testContext.pollingInterval) {
      clearInterval(testContext.pollingInterval);
      testContext.pollingInterval = null;
    }
    testContext.cachedStatus = { ...initialStatusFahrenheit };
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

  // --- Test Cases ---
  describe('Initialization', () => {
    it('should create AirConditionerAPI instance', () => {
      // Reset the mock completely
      (AirConditionerAPI as jest.Mock).mockClear();
      
      // Mock startPolling to avoid setting timers
      jest.spyOn(TfiacPlatformAccessory.prototype, 'startPolling').mockImplementation(function() {
        // Empty mock implementation that doesn't set intervals and doesn't access this.log
        return;
      });
      
      // Create a new instance to trigger the constructor call
      const testDeviceConfig = { name: 'Test AC', ip: '192.168.1.99', port: 7777, updateInterval: 30 };
      const testMockAccessoryInstance = {
        context: { deviceConfig: testDeviceConfig },
        displayName: testDeviceConfig.name,
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
      accessory = new TfiacPlatformAccessory(mockPlatform, testMockAccessoryInstance);
      expect(AirConditionerAPI).toHaveBeenCalledWith(testDeviceConfig.ip, testDeviceConfig.port);
      
      // Clean up the spy
      (TfiacPlatformAccessory.prototype.startPolling as jest.SpyInstance).mockRestore();
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
      // Clear the mock history from the constructor
      mockApiActions.updateState.mockClear();
      
      // Directly call the method we want to test
      mockApiActions.updateState.mockImplementation(() => Promise.resolve({ ...initialStatusFahrenheit }));
      (accessory as any).updateCachedStatus();
      
      // Now check that updateState was called
      expect(mockApiActions.updateState).toBeCalled();
    });
  });

  describe('Polling', () => {
    it('should update cachedStatus periodically', async () => {
      // Clear the mock history from the constructor
      mockApiActions.updateState.mockClear();
      
      // Setup test data
      const testContext = accessory as unknown as TestAccessoryContext;
      const initialStatus = { ...initialStatusFahrenheit, current_temp: 68, fan_mode: 'Auto' };
      const updatedStatusF = { ...initialStatusFahrenheit, current_temp: 72, fan_mode: 'High' };
      
      testContext.cachedStatus = initialStatus;
      
      // Set up our mock implementation
      mockApiActions.updateState.mockImplementation(() => Promise.resolve(updatedStatusF));
      
      // Manually trigger the update
      (accessory as any).updateCachedStatus();
      
      // Verify updateState was called
      expect(mockApiActions.updateState).toHaveBeenCalled();
      
      // Use await to wait for promises to resolve
      await Promise.resolve();
      
      // Verify cached status was updated
      expect(testContext.cachedStatus?.current_temp).toBe(updatedStatusF.current_temp);
    });

    it('should handle errors in polling gracefully', async () => {
      // Clear the mock history from the constructor
      mockApiActions.updateState.mockClear();
      mockLogger.error.mockClear();
      
      // Setup
      const testContext = accessory as unknown as TestAccessoryContext;
      const pollError = new Error('API call failed');
      
      // Setup initial state
      testContext.cachedStatus = { ...initialStatusFahrenheit };
      const initialCache = JSON.parse(JSON.stringify(testContext.cachedStatus));
      
      // Mock the error response
      mockApiActions.updateState.mockImplementation(() => Promise.reject(pollError));
      
      // Manually trigger the update
      (accessory as any).updateCachedStatus();
      
      // Verify updateState was called
      expect(mockApiActions.updateState).toHaveBeenCalled();
      
      // Wait for promises to resolve
      await Promise.resolve();
      
      // Need to advance timers to let async errors propagate
      jest.runAllTimers();
      await Promise.resolve();
      
      // Since we mocked a rejection, the error handler should be called
      expect(mockLogger.error).toHaveBeenCalledWith('Error updating cached status:', pollError);
      
      // The cached status should remain unchanged
      expect(testContext.cachedStatus).toEqual(initialCache);
    });

    it('stopPolling should clear interval and call API cleanup', () => {
      const testContext = accessory as unknown as TestAccessoryContext;
      testContext.pollingInterval = setTimeout(() => {}, 50000) as any;
      
      // Set up cleanup mock
      mockApiActions.cleanup.mockImplementation(() => Promise.resolve());
      (accessory as any).deviceAPI = { cleanup: mockApiActions.cleanup };
      
      // Call the method under test
      accessory.stopPolling();
      
      // Verify expectations
      expect(testContext.pollingInterval).toBeNull();
      expect(mockLogger.debug).toHaveBeenCalledWith('Polling stopped for %s', deviceConfig.name);
      expect(mockApiActions.cleanup).toBeCalled();
    });
  });

  describe('Characteristic Handlers - Active', () => {
    it('handleActiveSet(ACTIVE) should call deviceAPI.turnOn', (done) => {
      // Setup device API with the mock
      mockApiActions.turnOn.mockClear();
      mockApiActions.updateState.mockClear();
      
      // Set specific implementation for this test
      mockApiActions.turnOn.mockImplementation(() => {
        return Promise.resolve();
      });
      
      // Mock updateState to resolve immediately to avoid timing issues
      mockApiActions.updateState.mockImplementation(() => {
        return Promise.resolve({...initialStatusFahrenheit});
      });
      
      const handler = getHandlerByIdentifier(accessory, hapIdentifiers.Characteristic.Active, 'set');
      const value = hapConstants.Characteristic.Active.ACTIVE;
      
      const callback: CharacteristicSetCallback = (error) => {
        try {
          expect(error).toBeNull();
          expect(mockApiActions.turnOn).toBeCalled();
          expect(mockApiActions.turnOff).not.toHaveBeenCalled();
          // Now updateState will be called but that's fine, we just need to check turnOn
          done();
        } catch (e) {
          done(e as Error);
        }
      };
      
      handler(value, callback);
      // Run all pending promises
      jest.runAllTimers();
    });

    it('handleActiveSet(INACTIVE) should call deviceAPI.turnOff', (done) => {
      // Setup device API with the mock
      mockApiActions.turnOff.mockClear();
      mockApiActions.updateState.mockClear();
      
      // Set specific implementation for this test
      mockApiActions.turnOff.mockImplementation(() => {
        return Promise.resolve();
      });
      
      // Mock updateState to resolve immediately to avoid timing issues
      mockApiActions.updateState.mockImplementation(() => {
        return Promise.resolve({...initialStatusFahrenheit});
      });
      
      const handler = getHandlerByIdentifier(accessory, hapIdentifiers.Characteristic.Active, 'set');
      const value = hapConstants.Characteristic.Active.INACTIVE;
      
      const callback: CharacteristicSetCallback = (error) => {
        try {
          expect(error).toBeNull();
          expect(mockApiActions.turnOff).toBeCalled();
          expect(mockApiActions.turnOn).not.toHaveBeenCalled();
          // Now updateState will be called but that's fine, we just need to check turnOff
          done();
        } catch (e) {
          done(e as Error);
        }
      };
      
      handler(value, callback);
      // Run all pending promises
      jest.runAllTimers();
    });

    it('handleActiveSet should handle API errors', (done) => {
      // Setup device API with the mock
      (accessory as any).deviceAPI = mockApiActions;
      
      const apiError = new Error('API Failed');
      mockApiActions.turnOn.mockImplementation(() => Promise.reject(apiError));
      // Important: we need to clear updateState because the error comes BEFORE updateState is called
      mockApiActions.updateState.mockClear();
      
      const handler = getHandlerByIdentifier(accessory, hapIdentifiers.Characteristic.Active, 'set');
      const value = hapConstants.Characteristic.Active.ACTIVE;
      
      const callback: CharacteristicSetCallback = (error) => {
        try {
          expect(error).toBe(apiError);
          expect(mockApiActions.turnOn).toHaveBeenCalled();
          // When there's an error, updateState should not be called
          expect(mockApiActions.updateState).not.toHaveBeenCalled();
          done();
        } catch (e) {
          done(e as Error);
        }
      };
      
      handler(value, callback);
    });

    // ...other tests unchanged...
  });

  describe('Characteristic Handlers - TargetHeaterCoolerState', () => {
    const charId = hapIdentifiers.Characteristic.TargetHeaterCoolerState;

    it('should set operation_mode based on TargetHeaterCoolerState', (done) => {
      // Setup device API with the mock
      mockApiActions.setAirConditionerState.mockClear();
      mockApiActions.updateState.mockClear();
      
      // Set specific implementation for this test
      mockApiActions.setAirConditionerState.mockImplementation(() => {
        return Promise.resolve();
      });
      
      // Mock updateState to resolve immediately to avoid timing issues
      mockApiActions.updateState.mockImplementation(() => {
        return Promise.resolve({...initialStatusFahrenheit});
      });
      
      const handler = getHandlerByIdentifier(accessory, charId, 'set');
      const value = hapConstants.Characteristic.TargetHeaterCoolerState.HEAT;
      
      const callback: CharacteristicSetCallback = (error) => {
        try {
          expect(error).toBeNull();
          expect(mockApiActions.setAirConditionerState).toHaveBeenCalledWith('operation_mode', 'heat');
          // Now updateState will be called but that's fine
          done();
        } catch (e) {
          done(e as Error);
        }
      };
      
      handler(value, callback);
      // Run all pending promises
      jest.runAllTimers();
    });

    it('should handle API errors during set operation', (done) => {
      // Setup device API with the mock
      mockApiActions.setAirConditionerState.mockClear();
      mockApiActions.updateState.mockClear();
      
      const apiError = new Error('API Failed');
      mockApiActions.setAirConditionerState.mockImplementation(() => Promise.reject(apiError));
      
      const handler = getHandlerByIdentifier(accessory, charId, 'set');
      const value = hapConstants.Characteristic.TargetHeaterCoolerState.COOL;
      
      const callback: CharacteristicSetCallback = (error) => {
        try {
          expect(error).toBe(apiError);
          expect(mockApiActions.setAirConditionerState).toHaveBeenCalledWith('operation_mode', 'cool');
          // When there's an error, updateState should not be called
          expect(mockApiActions.updateState).not.toHaveBeenCalled();
          done();
        } catch (e) {
          done(e as Error);
        }
      };
      
      handler(value, callback);
    });
    
    // ...rest of tests
  });
  
  // ...rest of test suites
});