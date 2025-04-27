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
import { TfiacPlatformAccessory } from '../platformAccessory';
import AirConditionerAPI from '../AirConditionerAPI';
import { TfiacDeviceConfig } from '../settings';
import { jest, describe, beforeEach, afterEach, it, expect, beforeAll } from '@jest/globals';
import { 
  hapIdentifiers, 
  hapConstants, 
  initialStatusFahrenheit, 
  getHandlerByIdentifier, 
  mockPlatform, 
  initialStatusCelsius, 
  toFahrenheit 
} from './platformAccessory.core.test';

// --- Mock setup for characteristic tests ---
const mockApiActions = {
  updateState: jest.fn(),
  turnOn: jest.fn(),
  turnOff: jest.fn(),
  setAirConditionerState: jest.fn(),
  setFanSpeed: jest.fn(),
  setSwingMode: jest.fn(),
  setTurboState: jest.fn(),
  cleanup: jest.fn(),
};

jest.mock('../AirConditionerAPI', () => {
  return jest.fn().mockImplementation(() => {
    return mockApiActions;
  });
});

// Helper type for test context
interface TestAccessoryContext {
  pollingInterval: NodeJS.Timeout | null;
  cachedStatus: typeof initialStatusFahrenheit | null;
  deviceAPI?: { cleanup?: () => void };
  stopPolling?: () => void;
}

// Factory for Mock Characteristic
const createMockCharacteristic = () => {
  const onMethod = function(this: any, event: 'get' | 'set', handler: any): any {
    if (event === 'get') {
      this.getHandler = handler;
    } else {
      this.setHandler = handler;
    }
    return this;
  };
  
  return {
    value: null, 
    getHandler: undefined, 
    setHandler: undefined,
    on: jest.fn(onMethod),
    setProps: jest.fn().mockReturnThis(),
    updateValue: jest.fn(function(this: any, newValue: CharacteristicValue) {
      this.value = newValue; 
      return this;
    }),
  };
};

// Factory for Mock Service
const createMockService = () => {
  const characteristics = new Map<string, any>();
  
  return {
    characteristics,
    getCharacteristic: jest.fn((charIdentifier: any) => {
      const key = (charIdentifier && typeof charIdentifier === 'object' && 'UUID' in charIdentifier)
        ? (charIdentifier as { UUID: string }).UUID
        : String(charIdentifier);
      if (!characteristics.has(key)) {
        characteristics.set(key, createMockCharacteristic());
      }
      return characteristics.get(key)!;
    }),
    setCharacteristic: jest.fn(function(this: any, charIdentifier: any, value: CharacteristicValue) {
      const mockChar = this.getCharacteristic(charIdentifier); 
      mockChar.updateValue(value); 
      return this;
    }),
    updateCharacteristic: jest.fn(function(this: any, charIdentifier: any, value: any) {
      return this.setCharacteristic(charIdentifier, value);
    }),
  };
};

describe('TfiacPlatformAccessory - Characteristics', () => {
  let accessory: TfiacPlatformAccessory;
  let deviceConfig: TfiacDeviceConfig;
  let mockAccessoryInstance: PlatformAccessory;
  let mockServiceInstance: any;

  beforeAll(() => {
    jest.setTimeout(10000);
  });

  beforeEach(() => {
    jest.useFakeTimers();
    mockServiceInstance = createMockService();
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

    it('handleThresholdTemperatureSet should call API with Fahrenheit value', (done) => {
      const handler = getHandlerByIdentifier(mockServiceInstance, coolingCharId, 'set');
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
      const handler = getHandlerByIdentifier(mockServiceInstance, heatingCharId, 'set');
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

    it('should set fan mode to High based on percentage > 50', (done) => {
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'set');
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
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'set');
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
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'set');
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
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'set');
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
      (accessory as unknown as TestAccessoryContext).cachedStatus = { ...initialStatusFahrenheit, swing_mode: 'Both' };
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'get');
      const callback: CharacteristicGetCallback = (error, value) => {
        expect(error).toBeNull();
        expect(value).toBe(1);
        done();
      };
      handler(callback);
    });

    it('should set swing mode to Both (ENABLED)', (done) => {
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'set');
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
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'set');
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
        expect(helperMethods.mapHomebridgeModeToAPIMode(targetStateChar.AUTO)).toBe('auto');
        expect(helperMethods.mapHomebridgeModeToAPIMode(targetStateChar.HEAT)).toBe('heat');
        expect(helperMethods.mapHomebridgeModeToAPIMode(targetStateChar.COOL)).toBe('cool');
      });
      
      it('should map API modes to Homebridge modes correctly', () => {
        const targetStateChar = hapConstants.Characteristic.TargetHeaterCoolerState;
        expect(helperMethods.mapAPIModeToHomebridgeMode('auto')).toBe(targetStateChar.AUTO);
        expect(helperMethods.mapAPIModeToHomebridgeMode('heat')).toBe(targetStateChar.HEAT);
        expect(helperMethods.mapAPIModeToHomebridgeMode('cool')).toBe(targetStateChar.COOL);
        expect(helperMethods.mapAPIModeToHomebridgeMode('dry')).toBe(targetStateChar.COOL);
        expect(helperMethods.mapAPIModeToHomebridgeMode('fan')).toBe(targetStateChar.AUTO);
        expect(helperMethods.mapAPIModeToHomebridgeMode('unknown')).toBe(targetStateChar.AUTO);
      });
    });
  });
});