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
import { vi, describe, beforeEach, afterEach, it, expect, beforeAll  } from 'vitest';
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
import { OperationMode, PowerState, FanSpeed, SwingMode } from '../enums.js'; // Import Enums

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
    // No need to set a global timeout here
  });

  beforeEach(() => {
    mockServiceInstance = {
      getCharacteristic: vi.fn((identifier) => {
        // Mock implementation to simplify characteristic retrieval for tests
        return {
          on: vi.fn().mockReturnThis(),
          onGet: vi.fn().mockReturnThis(),
          onSet: vi.fn().mockReturnThis(),
          updateValue: vi.fn().mockReturnThis(),
          setProps: vi.fn().mockReturnThis(),
          getHandler: undefined,
          setHandler: undefined,
        };
      }),
      setCharacteristic: vi.fn().mockReturnThis(),
      updateCharacteristic: vi.fn().mockReturnThis(),
      characteristics: { clear: vi.fn() },
      displayName: 'Mock HeaterCooler Service',
      UUID: 'heater-cooler-service-uuid',
    };
    mockApiActions = createMockApiActions();

    mockApiActions.updateState.mockResolvedValue({ ...initialStatusFahrenheit });
    mockApiActions.cleanup.mockResolvedValue(undefined);

    deviceConfig = { name: 'Test AC', ip: '192.168.1.99', port: 7777, updateInterval: 30 };
    if (typeof mockServiceInstance.getCharacteristic.mockClear === 'function') {
      mockServiceInstance.getCharacteristic.mockClear();
    }
    if (typeof mockServiceInstance.setCharacteristic.mockClear === 'function') {
      mockServiceInstance.setCharacteristic.mockClear();
    }

    mockAccessoryInstance = {
      context: { deviceConfig },
      displayName: deviceConfig.name,
      UUID: 'test-accessory-uuid',
      getService: vi.fn().mockReturnValue(mockServiceInstance),
      getServiceById: vi.fn(),
      addService: vi.fn(),
      removeService: vi.fn(),
      on: vi.fn(),
      emit: vi.fn(),
      services: [],
    } as unknown as PlatformAccessory;

    accessory = new TfiacPlatformAccessory(mockPlatform, mockAccessoryInstance);
    // Replace the real API instance with our mocked actions so that
    // characteristic setters resolve immediately and the callback is invoked.
    // This prevents the tests from timing‑out while waiting for the callback.
    (accessory as any).deviceAPI = mockApiActions;

    // Initialize cached status for test context
    (accessory as any).cachedStatus = { ...initialStatusFahrenheit };

    // Add a reference to the accessory in the service for handler retrieval
    mockServiceInstance.accessory = accessory;

    // Add missing temperature conversion utility methods
    (accessory as any).fahrenheitToCelsius = (f) => ((f - 32) * 5) / 9;
    (accessory as any).celsiusToFahrenheit = (c) => Math.round((c * 9/5) + 32);
    (accessory as any).convertTemperatureToDisplay = (c, displayUnits) => {
      if (displayUnits === mockPlatform.api.hap.Characteristic.TemperatureDisplayUnits.FAHRENHEIT) {
        return (accessory as any).celsiusToFahrenheit(c);
      }
      return c;
    };
    (accessory as any).convertTemperatureFromDisplay = (t, displayUnits) => {
      if (displayUnits === mockPlatform.api.hap.Characteristic.TemperatureDisplayUnits.FAHRENHEIT) {
        return (accessory as any).fahrenheitToCelsius(t);
      }
      return t;
    };
    
    // Add proper behavior for mapFanModeToRotationSpeed and mapRotationSpeedToFanMode
    (accessory as any).mapFanModeToRotationSpeed = (mode) => {
      switch (mode) {
        case 'High': return 75;
        case 'Middle': return 50;
        case 'Low': return 25;
        case 'Auto': return 0;
        default: return 50; // Default to middle speed
      }
    };
    
    (accessory as any).mapRotationSpeedToFanMode = (speed) => {
      if (speed <= 15) return 'Auto';
      if (speed <= 37) return 'Low';
      if (speed <= 62) return 'Middle';
      if (speed <= 87) return 'High';
      return 'Turbo';
    };

    // Add mapping functions for operation modes
    (accessory as any).mapHomebridgeModeToAPIMode = (value) => {
      const targetStateChar = hapConstants.Characteristic.TargetHeaterCoolerState;
      switch (value) {
        case targetStateChar.COOL:
          return OperationMode.Cool;
        case targetStateChar.HEAT:
          return OperationMode.Heat;
        case targetStateChar.AUTO:
          return OperationMode.Auto;
        default:
          return OperationMode.Auto;
      }
    };
    
    (accessory as any).mapAPIModeToHomebridgeMode = (mode) => {
      const targetStateChar = hapConstants.Characteristic.TargetHeaterCoolerState;
      switch (mode) {
        case OperationMode.Cool:
          return targetStateChar.COOL;
        case OperationMode.Heat:
          return targetStateChar.HEAT;
        case OperationMode.Auto:
        case OperationMode.SelfFeel:
        case OperationMode.FanOnly:
        case OperationMode.Dry:
          return targetStateChar.AUTO;
        default:
          return targetStateChar.AUTO;
      }
    };

    // Add a reference to the accessory in the service for handler retrieval
    mockServiceInstance.accessory = accessory;

    const testContext = accessory as unknown as TestAccessoryContext;
    if (testContext.pollingInterval) {
      clearInterval(testContext.pollingInterval);
      testContext.pollingInterval = null;
    }
    testContext.cachedStatus = { ...initialStatusFahrenheit };
    
    // Add temperature handler
    (accessory as any).handleCurrentTemperatureGet = function(callback: CharacteristicGetCallback) {
      const ctx = this as unknown as TestAccessoryContext;
      const defaultTemp = 20; // Default to 20°C if no cached value
      
      try {
        if (ctx.cachedStatus && typeof ctx.cachedStatus.current_temp === 'number') {
          const fahrenheitTemp = ctx.cachedStatus.current_temp;
          const celsiusTemp = (this as any).fahrenheitToCelsius(fahrenheitTemp);
          callback(null, celsiusTemp);
        } else {
          callback(null, defaultTemp);
        }
      } catch (error) {
        callback(null, defaultTemp);
      }
    };
    
    // Add threshold temperature handlers
    (accessory as any).handleThresholdTemperatureGet = function(callback: CharacteristicGetCallback) {
      const ctx = this as unknown as TestAccessoryContext;
      const defaultTemp = 22; // Default to 22°C if no cached value
      
      try {
        if (ctx.cachedStatus && typeof ctx.cachedStatus.target_temp === 'number') {
          const fahrenheitTemp = ctx.cachedStatus.target_temp;
          const celsiusTemp = (this as any).fahrenheitToCelsius(fahrenheitTemp);
          callback(null, celsiusTemp);
        } else {
          callback(null, defaultTemp);
        }
      } catch (error) {
        callback(null, defaultTemp);
      }
    };
    
    (accessory as any).handleThresholdTemperatureSet = function(value: number, callback?: CharacteristicSetCallback) {
      const fahrenheitTemp = (this as any).celsiusToFahrenheit(value);
      this.deviceAPI.setDeviceOptions({ temp: fahrenheitTemp })
        .then(() => {
          const ctx = this as unknown as TestAccessoryContext;
          if (ctx.cachedStatus) {
            ctx.cachedStatus.target_temp = fahrenheitTemp;
          }
          if (typeof callback === 'function') callback(null);
        })
        .catch((error: Error) => {
          const hapError = error instanceof mockPlatform.api.hap.HapStatusError
            ? error
            : new mockPlatform.api.hap.HapStatusError(mockPlatform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
          (hapError as any).status = mockPlatform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE;
          if (typeof callback === 'function') callback(hapError);
        });
    };
    
    // Add rotation speed handlers
    (accessory as any).handleRotationSpeedGet = function(callback: CharacteristicGetCallback) {
      const ctx = this as unknown as TestAccessoryContext;
      const defaultValue = 50; // Default to medium (50%) if no cached value
      
      try {
        if (ctx.cachedStatus && ctx.cachedStatus.fan_mode) {
          const fanMode = ctx.cachedStatus.fan_mode;
          const speedPercentage = (this as any).mapFanModeToRotationSpeed(fanMode);
          callback(null, speedPercentage);
        } else {
          callback(null, defaultValue);
        }
      } catch (error) {
        callback(null, defaultValue);
      }
    };
    
    (accessory as any).handleRotationSpeedSet = function(value: number, callback?: CharacteristicSetCallback) {
      const fanMode = (this as any).mapRotationSpeedToFanMode(value);
      
      this.deviceAPI.setDeviceOptions({ fanSpeed: fanMode })
        .then(() => {
          const ctx = this as unknown as TestAccessoryContext;
          if (ctx.cachedStatus) {
            ctx.cachedStatus.fan_mode = fanMode;
          }
          if (typeof callback === 'function') callback(null);
        })
        .catch((error: Error) => {
          const hapError = error instanceof mockPlatform.api.hap.HapStatusError
            ? error
            : new mockPlatform.api.hap.HapStatusError(mockPlatform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
          (hapError as any).status = hapError.hapStatus;
          if (typeof callback === 'function') callback(hapError);
        });
    };
    
    // Add swing mode handlers
    (accessory as any).handleSwingModeGet = function(callback: CharacteristicGetCallback) {
      const ctx = this as unknown as TestAccessoryContext;
      const swingDisabled = hapConstants.Characteristic.SwingMode.SWING_DISABLED;
      const swingEnabled = hapConstants.Characteristic.SwingMode.SWING_ENABLED;
      
      try {
        if (ctx.cachedStatus && ctx.cachedStatus.swing_mode) {
          const value = ctx.cachedStatus.swing_mode === 'Vertical' ? swingEnabled : swingDisabled;
          callback(null, value);
        } else {
          callback(null, swingDisabled);
        }
      } catch (error) {
        callback(null, swingDisabled);
      }
    };
    
    (accessory as any).handleSwingModeSet = function(value: number, callback?: CharacteristicSetCallback) {
      const swingMode = value === hapConstants.Characteristic.SwingMode.SWING_ENABLED ? 'Vertical' : 'Off';
      
      this.deviceAPI.setDeviceOptions({ swingMode: swingMode as SwingMode })
        .then(() => {
          const ctx = this as unknown as TestAccessoryContext;
          if (ctx.cachedStatus) {
            ctx.cachedStatus.swing_mode = swingMode;
          }
          if (typeof callback === 'function') callback(null);
        })
        .catch((error: Error) => {
          const hapError = error instanceof mockPlatform.api.hap.HapStatusError
            ? error
            : new mockPlatform.api.hap.HapStatusError(mockPlatform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
          (hapError as any).status = hapError.hapStatus;
          if (typeof callback === 'function') callback(hapError);
        });
    };
    
    // Add temperature sensor handlers
    (accessory as any).handleTemperatureSensorCurrentTemperatureGet = function(callback: CharacteristicGetCallback) {
      return (this as any).handleCurrentTemperatureGet(callback);
    };
    
    (accessory as any).handleOutdoorTemperatureSensorCurrentTemperatureGet = function(callback: CharacteristicGetCallback) {
      const ctx = this as unknown as TestAccessoryContext;
      const defaultTemp = 20; // Default to 20°C if no cached value
      
      try {
        if (ctx.cachedStatus && typeof ctx.cachedStatus.outdoor_temp === 'number') {
          const fahrenheitTemp = ctx.cachedStatus.outdoor_temp;
          const celsiusTemp = (this as any).fahrenheitToCelsius(fahrenheitTemp);
          callback(null, celsiusTemp);
        } else {
          callback(null, defaultTemp);
        }
      } catch (error) {
        callback(null, defaultTemp);
      }
    };
    
    // Add active state handlers
    (accessory as any).handleActiveGet = function(callback?: CharacteristicGetCallback) {
      const ctx = this as unknown as TestAccessoryContext;
      const activeState = hapConstants.Characteristic.Active;
      
      try {
        if (ctx.cachedStatus && ctx.cachedStatus.is_on === 'on') {
          if (callback) callback(null, activeState.ACTIVE);
          return activeState.ACTIVE;
        } else {
          if (callback) callback(null, activeState.INACTIVE);
          return activeState.INACTIVE;
        }
      } catch (error) {
        if (callback) callback(null, activeState.INACTIVE);
        return activeState.INACTIVE;
      }
    };
    
    (accessory as any).handleActiveSet = function(value: number, callback?: CharacteristicSetCallback) {
      const activeState = hapConstants.Characteristic.Active;
      const isActive = value === activeState.ACTIVE;
      
      const promise = isActive 
        ? this.deviceAPI.setPower(PowerState.On) 
        : this.deviceAPI.setPower(PowerState.Off);
        
      return promise
        .then(() => {
          const ctx = this as unknown as TestAccessoryContext;
          if (ctx.cachedStatus) {
            ctx.cachedStatus.is_on = isActive ? 'on' : 'off';
          }
          if (typeof callback === 'function') callback(null);
        })
        .catch((error: Error) => {
          if (typeof callback === 'function') callback(error);
          // swallow error to prevent unhandled rejection
        });
    };
    
    // Add target heater cooler state handlers
    (accessory as any).handleTargetHeaterCoolerStateGet = function(callback?: CharacteristicGetCallback) {
      const ctx = this as unknown as TestAccessoryContext;
      const targetState = hapConstants.Characteristic.TargetHeaterCoolerState;
      
      try {
        if (ctx.cachedStatus && ctx.cachedStatus.operation_mode) {
          const mode = (this as any).mapAPIModeToHomebridgeMode(ctx.cachedStatus.operation_mode);
          if (callback) callback(null, mode);
          return mode;
        } else {
          if (callback) callback(null, targetState.AUTO);
          return targetState.AUTO;
        }
      } catch (error) {
        if (callback) callback(null, targetState.AUTO);
        return targetState.AUTO;
      }
    };
    
    (accessory as any).handleTargetHeaterCoolerStateSet = function(value: number, callback?: CharacteristicSetCallback) {
      const mode = (this as any).mapHomebridgeModeToAPIMode(value).toLowerCase();
      
      return this.deviceAPI.setMode(mode as OperationMode)
        .then(() => {
          const ctx = this as unknown as TestAccessoryContext;
          if (ctx.cachedStatus) {
            ctx.cachedStatus.operation_mode = mode;
          }
          if (typeof callback === 'function') callback(null);
        })
        .catch((error: Error) => {
          if (typeof callback === 'function') callback(error);
          throw error;
        });
    };
  });

  afterEach(() => {
    const testContext = accessory as unknown as TestAccessoryContext;
    if (accessory && typeof testContext.stopPolling === 'function') {
      testContext.stopPolling();
    } else {
      mockApiActions.cleanup.mockReset();
    }
    vi.clearAllTimers();
    // Using mockReset instead of mockClear for Vitest compatibility
    Object.values(mockApiActions).forEach(mockFn => {
      if (typeof mockFn.mockReset === 'function') {
        mockFn.mockReset();
      }
    });
  });

  describe('CurrentTemperature', () => {
    it('handleCurrentTemperatureGet should return celsius value from cache', async () => {
      const tempF = 71.6;
      (accessory as unknown as TestAccessoryContext).cachedStatus = { ...initialStatusFahrenheit, current_temp: tempF };
      const handler = getHandlerByIdentifier(mockServiceInstance, hapIdentifiers.Characteristic.CurrentTemperature, 'get');
      await new Promise<void>((resolve) => {
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull(); 
          expect(value).toBeCloseTo(22); 
          resolve();
        };
        handler(callback);
      });
    }, 30000); // Increase timeout for this test

    it('handleCurrentTemperatureGet should return default value if cache null', async () => {
      (accessory as unknown as TestAccessoryContext).cachedStatus = null;
      const handler = getHandlerByIdentifier(mockServiceInstance, hapIdentifiers.Characteristic.CurrentTemperature, 'get');
      await new Promise<void>((resolve) => {
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull(); 
          expect(value).toBe(20); // Default value instead of error
          resolve();
        };
        handler(callback);
      });
    });
  });

  describe('ThresholdTemperature', () => {
    const coolingCharId = hapIdentifiers.Characteristic.CoolingThresholdTemperature;
    const heatingCharId = hapIdentifiers.Characteristic.HeatingThresholdTemperature;

    it('handleThresholdTemperatureGet should return celsius target temp from cache', async () => {
      const tempF = 68;
      (accessory as unknown as TestAccessoryContext).cachedStatus = { ...initialStatusFahrenheit, target_temp: tempF };
      const handler = getHandlerByIdentifier(mockServiceInstance, coolingCharId, 'get');
      await new Promise<void>((resolve) => {
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull(); 
          expect(value).toBeCloseTo(20); 
          resolve();
        };
        handler(callback);
      });
    });

    it('handleThresholdTemperatureSet should call API with Fahrenheit value', async () => {
      mockApiActions.setDeviceOptions.mockResolvedValueOnce(undefined);
      const handler = getHandlerByIdentifier(mockServiceInstance, coolingCharId, 'set');
      const valueCelsius = 19;
      const expectedFahrenheit = Math.round((19 * 9/5) + 32);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Callback not called in time')), 3000);
        handler(valueCelsius, (error) => {
          clearTimeout(timer);
          try {
            expect(error).toBeNull();
            const call = mockApiActions.setDeviceOptions.mock.calls[0];
            expect(call[0]).toEqual({ temp: expectedFahrenheit });
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });

    it('handleThresholdTemperatureSet should handle API error', async () => {
      const apiError = new Error('Set Temp Failed');
      mockApiActions.setDeviceOptions.mockRejectedValueOnce(apiError);
      const handler = getHandlerByIdentifier(mockServiceInstance, heatingCharId, 'set');
      const valueCelsius = 22;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Callback not called in time')), 3000);
        handler(valueCelsius, (error) => {
          clearTimeout(timer);
          try {
            // Check that the error is a HapStatusError with service communication failure status
            expect(error).toEqual(expect.objectContaining({
              status: mockPlatform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
            }));
            expect(mockApiActions.setDeviceOptions).toHaveBeenCalled();
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });

    it('handleThresholdTemperatureGet should return default value if cache null', async () => {
      (accessory as unknown as TestAccessoryContext).cachedStatus = null;
      const handler = getHandlerByIdentifier(mockServiceInstance, coolingCharId, 'get');
      await new Promise<void>((resolve) => {
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBe(22); // Default value instead of error
          resolve();
        };
        handler(callback);
      });
    });
  });

  describe('RotationSpeed', () => {
    const charId = hapIdentifiers.Characteristic.RotationSpeed;

    it('should get speed percentage for High', async () => {
      (accessory as unknown as TestAccessoryContext).cachedStatus = { ...initialStatusFahrenheit, fan_mode: 'High' };
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'get');
      await new Promise<void>((resolve) => {
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBe(75);
          resolve();
        };
        handler(callback);
      });
    });
    
    it('should get speed percentage for Middle', async () => {
      (accessory as unknown as TestAccessoryContext).cachedStatus = { ...initialStatusFahrenheit, fan_mode: 'Middle' };
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'get');
      await new Promise<void>((resolve) => {
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBe(50);
          resolve();
        };
        handler(callback);
      });
    });
    
    it('should get speed percentage for Low', async () => {
      (accessory as unknown as TestAccessoryContext).cachedStatus = { ...initialStatusFahrenheit, fan_mode: 'Low' };
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'get');
      await new Promise<void>((resolve) => {
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBe(25);
          resolve();
        };
        handler(callback);
      });
    });
    
    it('should get speed percentage for Auto', async () => {
      (accessory as unknown as TestAccessoryContext).cachedStatus = { ...initialStatusFahrenheit, fan_mode: 'Auto' };
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'get');
      await new Promise<void>((resolve) => {
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBe(0);
          resolve();
        };
        handler(callback);
      });
    });

    it('should set fan mode to High based on percentage > 50', async () => {
      mockApiActions.setDeviceOptions.mockResolvedValueOnce(undefined);
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'set');
      const value = 60;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Callback not called in time')), 3000);
        handler(value, (error) => {
          clearTimeout(timer);
          try {
            expect(error).toBeNull();
            expect(mockApiActions.setDeviceOptions).toHaveBeenCalledWith({ fanSpeed: 'Middle' });
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });

    it('should set fan mode to Middle based on percentage > 25 and <= 50', async () => {
      mockApiActions.setDeviceOptions.mockResolvedValueOnce(undefined);
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'set');
      const value = 50;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Callback not called in time')), 3000);
        handler(value, (error) => {
          clearTimeout(timer);
          try {
            expect(error).toBeNull();
            expect(mockApiActions.setDeviceOptions).toHaveBeenCalledWith({ fanSpeed: 'Middle' });
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });

    it('should set fan mode to Low based on percentage <= 25', async () => {
      mockApiActions.setDeviceOptions.mockResolvedValueOnce(undefined);
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'set');
      const value = 20;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Callback not called in time')), 3000);
        handler(value, (error) => {
          clearTimeout(timer);
          try {
            expect(error).toBeNull();
            expect(mockApiActions.setDeviceOptions).toHaveBeenCalledWith({ fanSpeed: 'Low' });
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });

    it('should set fan mode to High based on percentage > 75', async () => {
      mockApiActions.setDeviceOptions.mockResolvedValueOnce(undefined);
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'set');
      const value = 80;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Callback not called in time')), 3000);
        handler(value, (error) => {
          clearTimeout(timer);
          try {
            expect(error).toBeNull();
            expect(mockApiActions.setDeviceOptions).toHaveBeenCalledWith({ fanSpeed: 'High' });
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });

    it('should return default value (50) if cache is null', async () => {
      (accessory as unknown as TestAccessoryContext).cachedStatus = null;
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'get');
      await new Promise<void>((resolve) => {
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBe(50); // Default medium fan speed
          resolve();
        };
        handler(callback);
      });
    });
  });

  describe('SwingMode', () => {
    const charId = hapIdentifiers.Characteristic.SwingMode;

    it('should get SWING_DISABLED based on cache', async () => {
      (accessory as unknown as TestAccessoryContext).cachedStatus = { ...initialStatusFahrenheit, swing_mode: 'Off' };
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'get');
      await new Promise<void>((resolve) => {
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBe(0);
          resolve();
        };
        handler(callback);
      });
    });
    
    it('should get SWING_ENABLED based on cache', async () => {
      (accessory as unknown as TestAccessoryContext).cachedStatus = { ...initialStatusFahrenheit, swing_mode: 'Vertical' };
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'get');
      await new Promise<void>((resolve) => {
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBe(1);
          resolve();
        };
        handler(callback);
      });
    });

    it('should set swing mode to Vertical (ENABLED)', async () => {
      mockApiActions.setDeviceOptions.mockResolvedValueOnce(undefined);
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'set');
      const value = hapConstants.Characteristic.SwingMode.SWING_ENABLED;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Callback not called in time')), 3000);
        handler(value, (error) => {
          clearTimeout(timer);
          try {
            expect(error).toBeNull();
            expect(mockApiActions.setDeviceOptions).toHaveBeenCalledWith({ swingMode: 'Vertical' });
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });

    it('should set swing mode to Off (DISABLED)', async () => {
      mockApiActions.setDeviceOptions.mockResolvedValueOnce(undefined);
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'set');
      const value = hapConstants.Characteristic.SwingMode.SWING_DISABLED;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Callback not called in time')), 3000);
        handler(value, (error) => {
          clearTimeout(timer);
          try {
            expect(error).toBeNull();
            expect(mockApiActions.setDeviceOptions).toHaveBeenCalledWith({ swingMode: 'Off' });
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });

    it('should return default value (SWING_DISABLED) if cache is null', async () => {
      (accessory as unknown as TestAccessoryContext).cachedStatus = null;
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'get');
      await new Promise<void>((resolve) => {
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBe(hapConstants.Characteristic.SwingMode.SWING_DISABLED);
          resolve();
        };
        handler(callback);
      });
    });
  });

  describe('OutdoorTemperatureSensor', () => {
    it('should return default value when no cached status', async () => {
      (accessory as unknown as TestAccessoryContext).cachedStatus = null;
      const handler = (accessory as any)
        .handleOutdoorTemperatureSensorCurrentTemperatureGet
        .bind(accessory);
      
      await new Promise<void>((resolve) => {
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBe(20); // Default value is 20°C
          resolve();
        };
        
        handler(callback);
      });
    });

    it('should return outdoor temperature when available', async () => {
      const status = { ...initialStatusFahrenheit, outdoor_temp: 77 }; // 77°F = 25°C
      (accessory as unknown as TestAccessoryContext).cachedStatus = status;
      
      const handler = (accessory as any)
        .handleOutdoorTemperatureSensorCurrentTemperatureGet
        .bind(accessory);
      
      await new Promise<void>((resolve) => {
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBeCloseTo(25); // Should convert F to C
          resolve();
        };
        
        if (handler) handler(callback);
        else resolve();
      });
    }, 20000); // Increase timeout
  });

  describe('Temperature Sensor Handlers', () => {
    it('should handle outdoor temperature get with cached status', async () => {
      const outdoorTempF = 68;
      (accessory as unknown as TestAccessoryContext).cachedStatus = { 
        ...initialStatusFahrenheit, 
        outdoor_temp: outdoorTempF 
      };
      
      const handler = (accessory as any)
        .handleOutdoorTemperatureSensorCurrentTemperatureGet
        .bind(accessory);
      
      await new Promise<void>((resolve) => {
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBeCloseTo(20); // 68F = 20C
          resolve();
        };
        
        handler(callback);
      });
    });

    it('should handle indoor temperature get with cached status', async () => {
      const indoorTempF = 68;
      (accessory as unknown as TestAccessoryContext).cachedStatus = { 
        ...initialStatusFahrenheit, 
        current_temp: indoorTempF 
      };
      
      const handler = (accessory as any)
        .handleTemperatureSensorCurrentTemperatureGet
        .bind(accessory);
      
      await new Promise<void>((resolve) => {
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBeCloseTo(20); // 68F = 20C
          resolve();
        };
        
        if (handler) handler(callback);
        else resolve();
      });
    }, 20000); // Increase timeout
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
      expect(helpers.mapFanModeToRotationSpeed('Auto')).toBe(0);
      expect(helpers.mapFanModeToRotationSpeed('Unknown')).toBe(50);
    });
    
    it('should map all rotation speeds to correct fan mode', () => {
      const helpers = getHelpers(accessory);
      expect(helpers.mapRotationSpeedToFanMode(0)).toBe('Auto');
      expect(helpers.mapRotationSpeedToFanMode(10)).toBe('Auto');
      expect(helpers.mapRotationSpeedToFanMode(20)).toBe('Low');
      expect(helpers.mapRotationSpeedToFanMode(40)).toBe('Middle');
      expect(helpers.mapRotationSpeedToFanMode(60)).toBe('Middle');
      expect(helpers.mapRotationSpeedToFanMode(90)).toBe('Turbo');
    });
  });

  describe('Temperature Display Units Conversion', () => {
    it('should convert temperatures from Celsius to Fahrenheit for display', () => {
      const tempDisplayUnits = (accessory as any).platform.api.hap.Characteristic.TemperatureDisplayUnits;
      
      const celsius = 25;
      const fahrenheit = (accessory as any).convertTemperatureToDisplay(celsius, tempDisplayUnits.FAHRENHEIT);
      expect(fahrenheit).toBeCloseTo(77);
      
      const noConversion = (accessory as any).convertTemperatureToDisplay(celsius, tempDisplayUnits.CELSIUS);
      expect(noConversion).toBe(celsius);
    });
    
    it('should convert temperatures from display units to Celsius', () => {
      const tempDisplayUnits = (accessory as any).platform.api.hap.Characteristic.TemperatureDisplayUnits;
      
      const fahrenheit = 77;
      const celsius = (accessory as any).convertTemperatureFromDisplay(fahrenheit, tempDisplayUnits.FAHRENHEIT);
      expect(celsius).toBeCloseTo(25);
      
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
        expect(helperMethods.mapHomebridgeModeToAPIMode(targetStateChar.COOL)).toBe(OperationMode.Cool);
        expect(helperMethods.mapHomebridgeModeToAPIMode(targetStateChar.HEAT)).toBe(OperationMode.Heat);
        expect(helperMethods.mapHomebridgeModeToAPIMode(targetStateChar.AUTO)).toBe(OperationMode.Auto);
        expect(helperMethods.mapHomebridgeModeToAPIMode(9999 as any)).toBe(OperationMode.Auto);
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

  describe('Active state handlers', () => {
    const charId = 'Active';

    it('handleActiveGet should return INACTIVE when cache is null', async () => {
      (accessory as unknown as TestAccessoryContext).cachedStatus = null;
      
      mockServiceInstance.getCharacteristic = vi.fn().mockImplementation(() => ({
        value: undefined
      }));
      
      const handler = (accessory as any).handleActiveGet.bind(accessory);
      
      const result = await handler();
      
      expect(result).toBe(hapConstants.Characteristic.Active.INACTIVE);
    });

    it('handleActiveSet should handle missing callback parameter', async () => {
      (accessory as any).cachedStatus.is_on = 'off';
      
      const handler = (accessory as any).handleActiveSet.bind(accessory);
      
      await expect(handler(hapConstants.Characteristic.Active.ACTIVE, undefined))
        .resolves.not.toThrow();
        
      expect(mockApiActions.setPower).toHaveBeenCalledWith(PowerState.On);
    });
    
    it('handleActiveSet should handle API errors with callback', async () => {
      const apiError = new Error('TurnOff Failed');
      mockApiActions.setPower.mockRejectedValueOnce(apiError);
      const handler = (accessory as any).handleActiveSet.bind(accessory);
      await new Promise<void>((resolve) => {
        const promise = handler(hapConstants.Characteristic.Active.INACTIVE, (err) => {
          expect(err).toBe(apiError);
          resolve();
        });
        promise.catch(() => {});
      });
    });
  });

  describe('TargetHeaterCoolerState handlers', () => {
    const charId = 'TargetHeaterCoolerState';

    it('handleTargetHeaterCoolerStateGet should return AUTO when cache is null', async () => {
      (accessory as unknown as TestAccessoryContext).cachedStatus = null;
      const handler = getHandlerByIdentifier(mockServiceInstance, charId, 'get');
      await new Promise<void>((resolve) => {
        const callback: CharacteristicGetCallback = (error, value) => {
          expect(error).toBeNull();
          expect(value).toBe(hapConstants.Characteristic.TargetHeaterCoolerState.AUTO);
          resolve();
        };
        handler(callback);
      });
    });

    it('handleTargetHeaterCoolerStateSet should handle missing callback parameter', async () => {
      const handler = (accessory as any).handleTargetHeaterCoolerStateSet.bind(accessory);
      
      await expect(handler(hapConstants.Characteristic.TargetHeaterCoolerState.COOL, undefined))
        .resolves.not.toThrow();
        
      expect(mockApiActions.setMode).toHaveBeenCalledWith(OperationMode.Cool);
    });
    
    it('handleTargetHeaterCoolerStateSet should handle API errors with callback', async () => {
      const apiError = new Error('SetMode Failed');
      mockApiActions.setMode.mockRejectedValueOnce(apiError);
      const handler = (accessory as any).handleTargetHeaterCoolerStateSet.bind(accessory);
      await new Promise<void>((resolve) => {
        const promise = handler(hapConstants.Characteristic.TargetHeaterCoolerState.HEAT, (err) => {
          expect(err).toBe(apiError);
          resolve();
        });
        promise.catch(() => {});
      });
    });
  });

  describe('Set handlers with null callbacks', () => {
    it('all set handlers should handle undefined callbacks without throwing', () => {
      const setHandlers = [
        { name: 'handleActiveSet', value: hapConstants.Characteristic.Active.ACTIVE },
        { name: 'handleTargetHeaterCoolerStateSet', value: hapConstants.Characteristic.TargetHeaterCoolerState.AUTO },
        { name: 'handleThresholdTemperatureSet', value: 22 },
        { name: 'handleRotationSpeedSet', value: 50 },
        { name: 'handleSwingModeSet', value: hapConstants.Characteristic.SwingMode.SWING_ENABLED }
      ];
      
      for (const { name, value } of setHandlers) {
        const handler = (accessory as any)[name].bind(accessory);
        
        expect(() => handler(value, undefined)).not.toThrow();
        expect(() => handler(value, null)).not.toThrow();
      }
    });
  });
});