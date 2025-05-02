// @ts-nocheck
// platformAccessory.characteristics.test.ts

import {
  PlatformAccessory,
  CharacteristicValue,
  CharacteristicSetCallback,
  CharacteristicGetCallback,
  Categories,
} from 'homebridge';
import { TfiacPlatform } from '../platform';
import { TfiacPlatformAccessory } from '../platformAccessory.js';
import { TfiacDeviceConfig } from '../settings.js';
import { jest, describe, beforeEach, afterEach, it, expect, beforeAll } from '@jest/globals';
import { 
  createMockCharacteristic,
  createMockService,
  hapIdentifiers, 
  hapConstants, 
  initialStatusFahrenheit, 
  getHandlerByIdentifier, 
  mockPlatform, 
  initialStatusCelsius, 
  toFahrenheit,
  createMockApiActions
} from './testUtils.js';
import { OperationMode, PowerState, FanSpeed } from '../enums.js'; // Import Enums

// Interface for test context
interface TestAccessoryContext {
  pollingInterval: NodeJS.Timeout | null;
  cachedStatus: typeof initialStatusFahrenheit | null;
  deviceAPI?: { cleanup?: () => void };
  stopPolling?: () => void;
}

describe('TfiacPlatformAccessory - Characteristics', () => {
  let accessory: TfiacPlatformAccessory;
  let deviceConfig: TfiacDeviceConfig;
  let mockAccessoryInstance: PlatformAccessory;
  let mockServiceInstance: any;
  let mockApiActions;

  beforeAll(() => {
    jest.setTimeout(10000);
  });

  beforeEach(() => {
    mockServiceInstance = createMockService();
    mockApiActions = createMockApiActions();

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
    // Replace the real API instance with our mocked actions so that
    // characteristic setters resolve immediately and the callback is invoked.
    // This prevents the tests from timing‑out while waiting for the callback.
    (accessory as any).deviceAPI = mockApiActions;

    // Add a reference to the accessory in the service for handler retrieval
    mockServiceInstance.accessory = accessory;

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

  describe('CurrentTemperature', () => {
    it('handleCurrentTemperatureGet should return celsius value from cache', (done) => {
      const tempF = 71.6;
      (accessory as unknown as TestAccessoryContext).cachedStatus = { ...initialStatusFahrenheit, current_temp: tempF };
      const handler = getHandlerByIdentifier(mockServiceInstance, hapIdentifiers.Characteristic.CurrentTemperature, 'get');
      const callback: CharacteristicGetCallback = (error, value) => {
        expect(error).toBeNull(); 
        expect(value).toBeCloseTo(22); 
        done();
      };
      handler(callback);
    });

    it('handleCurrentTemperatureGet should return default value if cache null', (done) => {
      (accessory as unknown as TestAccessoryContext).cachedStatus = null;
      const handler = getHandlerByIdentifier(mockServiceInstance, hapIdentifiers.Characteristic.CurrentTemperature, 'get');
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
      const handler = getHandlerByIdentifier(mockServiceInstance, coolingCharId, 'get');
      const callback: CharacteristicGetCallback = (error, value) => {
        expect(error).toBeNull(); 
        expect(value).toBeCloseTo(20); 
        done();
      };
      handler(callback);
    });

    it('handleThresholdTemperatureSet should call API with Fahrenheit value', async () => {
      mockApiActions.setAirConditionerState.mockResolvedValueOnce(undefined);
      const handler = getHandlerByIdentifier(mockServiceInstance, coolingCharId, 'set');
      const valueCelsius = 19;
      const expectedFahrenheit = Math.round((19 * 9/5) + 32);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Callback not called in time')), 3000);
        handler(valueCelsius, (error) => {
          clearTimeout(timer);
          try {
            expect(error).toBeNull();
            const call = mockApiActions.setAirConditionerState.mock.calls[0];
            expect(call[0]).toBe('target_temp');
            expect(Math.round(Number(call[1]))).toBe(expectedFahrenheit);
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });

    it('handleThresholdTemperatureSet should handle API error', async () => {
      const apiError = new Error('Set Temp Failed');
      mockApiActions.setAirConditionerState.mockRejectedValueOnce(apiError);
      const handler = getHandlerByIdentifier(mockServiceInstance, heatingCharId, 'set');
      const valueCelsius = 22;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Callback not called in time')), 3000);
        handler(valueCelsius, (error) => {
          clearTimeout(timer);
          try {
            expect(error).toBe(apiError);
            expect(mockApiActions.setAirConditionerState).toHaveBeenCalled();
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });

    it('handleThresholdTemperatureGet should return default value if cache null', (done) => {
      (accessory as unknown as TestAccessoryContext).cachedStatus = null;
      const handler = getHandlerByIdentifier(mockServiceInstance, coolingCharId, 'get');
      const callback: CharacteristicGetCallback = (error, value) => {
        expect(error).toBeNull();
        expect(value).toBe(22); // Default value instead of error
        done();
      };
      handler(callback);
    });
  });

  describe('RotationSpeed', () => {
    const charId = hapIdentifiers.Characteristic.RotationSpeed;

    it('should get speed percentage for High', (done) => {
      (accessory as unknown as TestAccessoryContext).cachedStatus = { ...initialStatusFahrenheit, fan_mode: 'High' };
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'get');
      const callback: CharacteristicGetCallback = (error, value) => {
        expect(error).toBeNull();
        expect(value).toBe(75);
        done();
      };
      handler(callback);
    });
    
    it('should get speed percentage for Middle', (done) => {
      (accessory as unknown as TestAccessoryContext).cachedStatus = { ...initialStatusFahrenheit, fan_mode: 'Middle' };
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'get');
      const callback: CharacteristicGetCallback = (error, value) => {
        expect(error).toBeNull();
        expect(value).toBe(50);
        done();
      };
      handler(callback);
    });
    
    it('should get speed percentage for Low', (done) => {
      (accessory as unknown as TestAccessoryContext).cachedStatus = { ...initialStatusFahrenheit, fan_mode: 'Low' };
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'get');
      const callback: CharacteristicGetCallback = (error, value) => {
        expect(error).toBeNull();
        expect(value).toBe(25);
        done();
      };
      handler(callback);
    });
    
    it('should get speed percentage for Auto', (done) => {
      (accessory as unknown as TestAccessoryContext).cachedStatus = { ...initialStatusFahrenheit, fan_mode: 'Auto' };
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'get');
      const callback: CharacteristicGetCallback = (error, value) => {
        expect(error).toBeNull();
        expect(value).toBe(50);
        done();
      };
      handler(callback);
    });

    it('should set fan mode to High based on percentage > 50', async () => {
      mockApiActions.setFanSpeed.mockResolvedValueOnce(undefined);
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'set');
      const value = 60;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Callback not called in time')), 3000);
        handler(value, (error) => {
          clearTimeout(timer);
          try {
            expect(error).toBeNull();
            expect(mockApiActions.setFanSpeed).toHaveBeenCalledWith('High');
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });

    it('should set fan mode to Middle based on percentage > 25 and <= 50', async () => {
      mockApiActions.setFanSpeed.mockResolvedValueOnce(undefined);
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'set');
      const value = 50;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Callback not called in time')), 3000);
        handler(value, (error) => {
          clearTimeout(timer);
          try {
            expect(error).toBeNull();
            expect(mockApiActions.setFanSpeed).toHaveBeenCalledWith('Middle');
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });

    it('should set fan mode to Low based on percentage <= 25', async () => {
      mockApiActions.setFanSpeed.mockResolvedValueOnce(undefined);
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'set');
      const value = 20;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Callback not called in time')), 3000);
        handler(value, (error) => {
          clearTimeout(timer);
          try {
            expect(error).toBeNull();
            expect(mockApiActions.setFanSpeed).toHaveBeenCalledWith('Low');
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });

    it('should set fan mode to Auto based on percentage > 75', async () => {
      mockApiActions.setFanSpeed.mockResolvedValueOnce(undefined);
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'set');
      const value = 80;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Callback not called in time')), 3000);
        handler(value, (error) => {
          clearTimeout(timer);
          try {
            expect(error).toBeNull();
            expect(mockApiActions.setFanSpeed).toHaveBeenCalledWith('Auto');
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });

    it('should return default value (50) if cache is null', (done) => {
      (accessory as unknown as TestAccessoryContext).cachedStatus = null;
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'get');
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
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'get');
      const callback: CharacteristicGetCallback = (error, value) => {
        expect(error).toBeNull();
        expect(value).toBe(0);
        done();
      };
      handler(callback);
    });
    
    it('should get SWING_ENABLED based on cache', (done) => {
      (accessory as unknown as TestAccessoryContext).cachedStatus = { ...initialStatusFahrenheit, swing_mode: 'Vertical' };
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'get');
      const callback: CharacteristicGetCallback = (error, value) => {
        expect(error).toBeNull();
        expect(value).toBe(1);
        done();
      };
      handler(callback);
    });

    it('should set swing mode to Vertical (ENABLED)', async () => {
      mockApiActions.setSwingMode.mockResolvedValueOnce(undefined);
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'set');
      const value = hapConstants.Characteristic.SwingMode.SWING_ENABLED;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Callback not called in time')), 3000);
        handler(value, (error) => {
          clearTimeout(timer);
          try {
            expect(error).toBeNull();
            expect(mockApiActions.setSwingMode).toHaveBeenCalledWith('Vertical');
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });

    it('should set swing mode to Off (DISABLED)', async () => {
      mockApiActions.setSwingMode.mockResolvedValueOnce(undefined);
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'set');
      const value = hapConstants.Characteristic.SwingMode.SWING_DISABLED;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Callback not called in time')), 3000);
        handler(value, (error) => {
          clearTimeout(timer);
          try {
            expect(error).toBeNull();
            expect(mockApiActions.setSwingMode).toHaveBeenCalledWith('Off');
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });

    it('should return default value (SWING_DISABLED) if cache is null', (done) => {
      (accessory as unknown as TestAccessoryContext).cachedStatus = null;
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'get');
      const callback: CharacteristicGetCallback = (error, value) => {
        expect(error).toBeNull();
        expect(value).toBe(hapConstants.Characteristic.SwingMode.SWING_DISABLED);
        done();
      };
      handler(callback);
    });
  });

  describe('OutdoorTemperatureSensor', () => {
    it('should return default value when no cached status', done => {
      (accessory as unknown as TestAccessoryContext).cachedStatus = null;
      const handler = (accessory as any)
        .handleOutdoorTemperatureSensorCurrentTemperatureGet
        .bind(accessory);
      
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
        .bind(accessory);
      
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
    
    describe('Operation Mode Mapping', () => {
      it('should map Homebridge modes to API modes correctly', () => {
        const targetStateChar = hapConstants.Characteristic.TargetHeaterCoolerState;
        expect(helperMethods.mapHomebridgeModeToAPIMode(targetStateChar.AUTO)).toBe(OperationMode.Auto);
        expect(helperMethods.mapHomebridgeModeToAPIMode(targetStateChar.HEAT)).toBe(OperationMode.Heat);
        expect(helperMethods.mapHomebridgeModeToAPIMode(targetStateChar.COOL)).toBe(OperationMode.Cool);
        expect(helperMethods.mapHomebridgeModeToAPIMode(9999)).toBe(OperationMode.Auto); // Invalid value
      });
      
      it('should map API modes to Homebridge modes correctly', () => {
        const targetStateChar = hapConstants.Characteristic.TargetHeaterCoolerState;
        expect(helperMethods.mapAPIModeToHomebridgeMode(OperationMode.Auto)).toBe(targetStateChar.AUTO);
        expect(helperMethods.mapAPIModeToHomebridgeMode(OperationMode.Heat)).toBe(targetStateChar.HEAT);
        expect(helperMethods.mapAPIModeToHomebridgeMode(OperationMode.Cool)).toBe(targetStateChar.COOL);
        expect(helperMethods.mapAPIModeToHomebridgeMode(OperationMode.Dry)).toBe(targetStateChar.AUTO);
        expect(helperMethods.mapAPIModeToHomebridgeMode(OperationMode.FanOnly)).toBe(targetStateChar.AUTO);
        expect(helperMethods.mapAPIModeToHomebridgeMode('unknown' as OperationMode)).toBe(targetStateChar.AUTO);
      });
    });
  });
});