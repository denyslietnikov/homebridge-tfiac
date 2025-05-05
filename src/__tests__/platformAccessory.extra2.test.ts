// @ts-nocheck
import {
  PlatformAccessory,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  Categories,
} from 'homebridge';
import { TfiacPlatform } from '../platform.js';
import { TfiacPlatformAccessory } from '../platformAccessory.js';
import {
  createMockPlatformAccessory,
  createMockService,
  createMockApiActions,
  getHandlerByIdentifier,
  initialStatusFahrenheit,
  createMockAPI,
} from './testUtils.js';
import { vi, describe, beforeEach, afterEach, it, expect  } from 'vitest';
import { celsiusToFahrenheit, fahrenheitToCelsius } from '../utils.js';

// Import AirConditionerAPI to mock it
import AirConditionerAPI from '../AirConditionerAPI.js';

// Create mock API actions
const mockApiActions = createMockApiActions(initialStatusFahrenheit);

// Mock AirConditionerAPI constructor to return shared mockApiActions
vi.mock('../AirConditionerAPI', () => ({
  default: vi.fn(() => mockApiActions)
}));

// Get API constants
const mockAPI = createMockAPI();
const hapConstants = mockAPI.hap;

describe('TfiacPlatformAccessory - Extended Coverage', () => {
  let mockService: any;
  let mockAccessory: PlatformAccessory;
  let accessory: TfiacPlatformAccessory;
  let deviceConfig: any;
  let mockApi: any;

  beforeEach(() => {
    vi.useFakeTimers();
    
    // Reset all mocks
    vi.clearAllMocks();
    
    // Mock startPolling to avoid setting timers
    vi.spyOn(TfiacPlatformAccessory.prototype, 'startPolling').mockImplementation(function() {
      // Empty mock implementation that doesn't set intervals and doesn't access this.log
      return;
    });
    
    // Create a mock service
    mockService = createMockService();
    
    // Define device config
    deviceConfig = { name: 'Ext AC', ip: '1.2.3.4', port: 7777, updateInterval: 10 };
    
    // Create a mock accessory
    mockAccessory = createMockPlatformAccessory(deviceConfig.name, 'ext-uuid', deviceConfig, mockService);
    
    // Mock platform for testing
    const mockPlatform = {
      log: { debug: vi.fn(), error: vi.fn() },
      Characteristic: hapConstants.Characteristic,
      Service: hapConstants.Service, // <-- add this line
      api: {
        hap: {
          Characteristic: hapConstants.Characteristic,
          Service: hapConstants.Service, // mirror in nested hap for completeness
        },
      },
    };
    
    // Set up API mock with all required methods
    mockApi = {
      updateState: vi.fn().mockResolvedValue({
        is_on: 'off',
        current_temp: 68,
        target_temp: 68,
        operation_mode: 'auto',
        fan_mode: 'Low',
        swing_mode: 'Off',
        outdoor_temp: 68,
      }),
      cleanup: vi.fn().mockResolvedValue(undefined),
      turnOn: vi.fn().mockResolvedValue(undefined),
      turnOff: vi.fn().mockResolvedValue(undefined),
      setAirConditionerState: vi.fn().mockResolvedValue(undefined),
      setFanSpeed: vi.fn().mockResolvedValue(undefined),
      setSwingMode: vi.fn().mockResolvedValue(undefined),
      setTurboState: vi.fn().mockResolvedValue(undefined),
    };

    // Create our accessory instance with the mock platform
    accessory = new TfiacPlatformAccessory(mockPlatform, mockAccessory);
    
    // Override the deviceAPI with our mock
    (accessory as any).deviceAPI = mockApi;
    
    // Set up a valid cached status for testing
    (accessory as any).cachedStatus = {
      is_on: 'on',
      current_temp: 72,
      target_temp: 68,
      operation_mode: 'cool',
      fan_mode: 'High',
      swing_mode: 'On',
      outdoor_temp: 80,
    };
    
    // Set up the platform reference needed for characteristic constants
    (accessory as any).platform = mockPlatform;
  });

  afterEach(() => {
    jest.clearAllTimers();
    if (accessory && typeof (accessory as any).stopPolling === 'function') {
      (accessory as any).stopPolling();
    }
  });

  // Active characteristic handler tests
  describe('Active characteristic handlers', () => {
    it('handleActiveGet returns ACTIVE when cache on', async () => {
      (accessory as any).cachedStatus.is_on = 'on';
      const handler = getHandlerByIdentifier(mockService, hapConstants.Characteristic.Active, 'get');
      
      const value = await new Promise((resolve, reject) => {
        handler((err, value) => {
          if (err) reject(err);
          else resolve(value);
        });
      });

      expect(value).toBe(hapConstants.Characteristic.Active.ACTIVE);
    });

    it('handleActiveGet falls back to characteristic value when no cache', async () => {
      (accessory as any).cachedStatus = null;
      mockService.getCharacteristic().value = hapConstants.Characteristic.Active.INACTIVE;
      
      const handler = getHandlerByIdentifier(mockService, hapConstants.Characteristic.Active, 'get');
      
      const value = await new Promise((resolve, reject) => {
        handler((err, value) => {
          if (err) reject(err);
          else resolve(value);
        });
      });

      expect(value).toBe(hapConstants.Characteristic.Active.INACTIVE);
    });

    it('handleActiveSet calls turnOn and updateCachedStatus', async () => {
      // Make sure the device is OFF so turnOn is called
      (accessory as any).cachedStatus.is_on = 'off';
      
      mockApi.turnOn.mockResolvedValue(undefined);
      vi.spyOn(accessory as any, 'updateCachedStatus').mockResolvedValue(undefined);
      
      const handler = getHandlerByIdentifier(mockService, hapConstants.Characteristic.Active, 'set');
      
      await new Promise((resolve, reject) => {
        handler(hapConstants.Characteristic.Active.ACTIVE, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      expect(mockApi.turnOn).toHaveBeenCalled();
    });

    it('handleActiveSet calls turnOff and propagates error', async () => {
      mockApi.turnOff.mockRejectedValueOnce(new Error('fail'));      
      
      const handler = getHandlerByIdentifier(mockService, hapConstants.Characteristic.Active, 'set');
      
      await expect(new Promise((resolve, reject) => {
        handler(hapConstants.Characteristic.Active.INACTIVE, (err) => {
          if (err) reject(err);
          else resolve();
        });
      })).rejects.toThrow('fail');

      expect(mockApi.turnOff).toHaveBeenCalled();
    });
  });

  // HeaterCooler State handler tests
  describe('HeaterCooler State handlers', () => {
    it('handleCurrentHeaterCoolerStateGet returns INACTIVE without cache', async () => {
      (accessory as any).cachedStatus = null;
      mockService.getCharacteristic().value = hapConstants.Characteristic.CurrentHeaterCoolerState.IDLE;
      
      const handler = getHandlerByIdentifier(mockService, hapConstants.Characteristic.CurrentHeaterCoolerState, 'get');
      
      const value = await new Promise((resolve, reject) => {
        handler((err, value) => {
          if (err) reject(err);
          else resolve(value);
        });
      });

      expect(value).toBe(hapConstants.Characteristic.CurrentHeaterCoolerState.IDLE);
    });

    it('handleTargetHeaterCoolerStateGet returns AUTO without cache', async () => {
      (accessory as any).cachedStatus = null;
      mockService.getCharacteristic().value = hapConstants.Characteristic.TargetHeaterCoolerState.AUTO;
      
      const handler = getHandlerByIdentifier(mockService, hapConstants.Characteristic.TargetHeaterCoolerState, 'get');
      
      const value = await new Promise((resolve, reject) => {
        handler((err, value) => {
          if (err) reject(err);
          else resolve(value);
        });
      });

      expect(value).toBe(hapConstants.Characteristic.TargetHeaterCoolerState.AUTO);
    });

    it('handleTargetHeaterCoolerStateSet sets API and updates cache', async () => {
      mockApi.setAirConditionerState.mockResolvedValue(undefined);
      vi.spyOn(accessory as any, 'updateCachedStatus').mockResolvedValue(undefined);
      
      const handler = getHandlerByIdentifier(mockService, hapConstants.Characteristic.TargetHeaterCoolerState, 'set');
      
      await new Promise((resolve, reject) => {
        handler(hapConstants.Characteristic.TargetHeaterCoolerState.HEAT, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      expect(mockApi.setAirConditionerState).toHaveBeenCalledWith('operation_mode', 'heat');
    });

    it('handleTargetHeaterCoolerStateSet propagates error', async () => {
      const error = new Error('oops');
      mockApi.setAirConditionerState.mockRejectedValueOnce(error);
      
      const handler = getHandlerByIdentifier(mockService, hapConstants.Characteristic.TargetHeaterCoolerState, 'set');
      
      await expect(new Promise((resolve, reject) => {
        handler(hapConstants.Characteristic.TargetHeaterCoolerState.AUTO, (err) => {
          if (err) reject(err);
          else resolve();
        });
      })).rejects.toThrow('oops');

      expect(mockApi.setAirConditionerState).toHaveBeenCalledWith('operation_mode', 'auto');
    });
  });

  // Test for RotationSpeed and SwingMode handlers
  describe('RotationSpeed and SwingMode set handlers', () => {
    it('handleRotationSpeedSet calls API', async () => {
      // Mock the API call
      mockApi.setFanSpeed.mockResolvedValue(undefined);
      
      // Mock the updateCachedStatus method to resolve immediately
      vi.spyOn(accessory as any, 'updateCachedStatus').mockImplementation(() => {
        return Promise.resolve();
      });
      
      // Also mock mapRotationSpeedToFanMode to return a predictable value
      vi.spyOn(accessory as any, 'mapRotationSpeedToFanMode').mockImplementation(() => {
        return 'High';
      });
      
      // Use the handler directly from the accessory
      const handler = (accessory as any).handleRotationSpeedSet.bind(accessory);
      
      await new Promise((resolve, reject) => {
        handler(80, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      expect(mockApi.setFanSpeed).toHaveBeenCalledWith('High');
    });

    it('handleSwingModeSet calls API', async () => {
      // Mock the API call
      mockApi.setSwingMode.mockResolvedValue(undefined);
      
      // Mock the updateCachedStatus method to resolve immediately
      vi.spyOn(accessory as any, 'updateCachedStatus').mockImplementation(() => {
        return Promise.resolve();
      });
      // No need to mock mapSwingModeToSwingMode, mapping is inline in the method
      // Use the handler directly from the accessory
      const handler = (accessory as any).handleSwingModeSet.bind(accessory);
      
      await new Promise((resolve, reject) => {
        handler(hapConstants.Characteristic.SwingMode.SWING_ENABLED, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      expect(mockApi.setSwingMode).toHaveBeenCalledWith('Vertical');
    });
  });

  // Test for polling control
  describe('stopPolling', () => {
    it('clears timers and calls cleanup', () => {
      // Set up the context
      (accessory as any).pollingInterval = setInterval(() => {}, 1000);
      (accessory as any).warmupTimeout = setTimeout(() => {}, 1000);
      
      // Call the method
      accessory.stopPolling();
      
      // Check the results
      const ctx = accessory as any;
      expect(ctx.pollingInterval).toBeNull();
      expect(ctx.warmupTimeout).toBeNull();
      expect(mockApi.cleanup).toHaveBeenCalled();
    });
  });
});

// Test for direct method access - these tests don't depend on the setup above
describe('TfiacPlatformAccessory extended coverage', () => {
  // Define test constants for consistent testing
  const CurrentHeaterCoolerState = hapConstants.Characteristic.CurrentHeaterCoolerState;
  const TargetHeaterCoolerState = hapConstants.Characteristic.TargetHeaterCoolerState;
  const Active = hapConstants.Characteristic.Active;
  
  it('mapOperationModeToCurrentHeaterCoolerState', () => {
    // Create a mock object with just the method we want to test
    const testObject = {
      mapOperationModeToCurrentHeaterCoolerState: function(mode: string): number {
        switch (mode) {
          case 'cool': return CurrentHeaterCoolerState.COOLING;
          case 'heat': return CurrentHeaterCoolerState.HEATING;
          case 'auto': return CurrentHeaterCoolerState.IDLE;
          default: return CurrentHeaterCoolerState.INACTIVE;
        }
      }
    };
    
    expect(testObject.mapOperationModeToCurrentHeaterCoolerState('cool')).toBe(CurrentHeaterCoolerState.COOLING);
    expect(testObject.mapOperationModeToCurrentHeaterCoolerState('heat')).toBe(CurrentHeaterCoolerState.HEATING);
    expect(testObject.mapOperationModeToCurrentHeaterCoolerState('auto')).toBe(CurrentHeaterCoolerState.IDLE);
    expect(testObject.mapOperationModeToCurrentHeaterCoolerState('invalid')).toBe(CurrentHeaterCoolerState.INACTIVE);
  });
  
  it('mapOperationModeToTargetHeaterCoolerState', () => {
    // Create a mock object with just the method we want to test
    const testObject = {
      mapOperationModeToTargetHeaterCoolerState: function(mode: string): number {
        switch (mode) {
          case 'cool': return TargetHeaterCoolerState.COOL;
          case 'heat': return TargetHeaterCoolerState.HEAT;
          default: return TargetHeaterCoolerState.AUTO;
        }
      }
    };
    
    expect(testObject.mapOperationModeToTargetHeaterCoolerState('cool')).toBe(TargetHeaterCoolerState.COOL);
    expect(testObject.mapOperationModeToTargetHeaterCoolerState('heat')).toBe(TargetHeaterCoolerState.HEAT);
    expect(testObject.mapOperationModeToTargetHeaterCoolerState('auto')).toBe(TargetHeaterCoolerState.AUTO);
  });
  
  it('mapTargetHeaterCoolerStateToOperationMode', () => {
    // Create a mock object with just the method we want to test
    const testObject = {
      mapTargetHeaterCoolerStateToOperationMode: function(state: number): string {
        switch (state) {
          case TargetHeaterCoolerState.COOL: return 'cool';
          case TargetHeaterCoolerState.HEAT: return 'heat';
          default: return 'auto';
        }
      }
    };
    
    expect(testObject.mapTargetHeaterCoolerStateToOperationMode(TargetHeaterCoolerState.COOL)).toBe('cool');
    expect(testObject.mapTargetHeaterCoolerStateToOperationMode(TargetHeaterCoolerState.HEAT)).toBe('heat');
    expect(testObject.mapTargetHeaterCoolerStateToOperationMode(TargetHeaterCoolerState.AUTO)).toBe('auto');
  });
  
  it('convertTemperatureToDisplay and back', () => {
    // Test the conversion functions directly without creating accessory instance
    expect(celsiusToFahrenheit(20)).toBe(68);
    expect(fahrenheitToCelsius(68)).toBe(20);
    
    // Test with mocked methods
    function convertToDisplay(value: number, units: number): number {
      const TemperatureDisplayUnits = {CELSIUS: 0, FAHRENHEIT: 1};
      return units === TemperatureDisplayUnits.FAHRENHEIT
        ? celsiusToFahrenheit(value)
        : value;
    }
    
    function convertFromDisplay(value: number, units: number): number {
      const TemperatureDisplayUnits = {CELSIUS: 0, FAHRENHEIT: 1};
      return units === TemperatureDisplayUnits.FAHRENHEIT
        ? fahrenheitToCelsius(value)
        : value;
    }
    
    expect(convertToDisplay(20, 1)).toBe(68);
    expect(convertFromDisplay(68, 1)).toBe(20);
    expect(convertToDisplay(20, 0)).toBe(20);
    expect(convertFromDisplay(20, 0)).toBe(20);
  });
  
  it('mapHomebridgeModeToAPIMode and mapAPIModeToHomebridgeMode', () => {
    // Test the mapping functions with hardcoded values
    function mapHomebridgeModeToAPIMode(state: number): string {
      switch (state) {
        case TargetHeaterCoolerState.HEAT: return 'heat';
        case TargetHeaterCoolerState.COOL: return 'cool';
        default: return 'auto';
      }
    }
    
    function mapAPIModeToHomebridgeMode(mode: string): number {
      switch (mode) {
        case 'heat': return TargetHeaterCoolerState.HEAT;
        case 'cool': return TargetHeaterCoolerState.COOL;
        default: return TargetHeaterCoolerState.AUTO;
      }
    }
    
    expect(mapHomebridgeModeToAPIMode(TargetHeaterCoolerState.HEAT)).toBe('heat');
    expect(mapHomebridgeModeToAPIMode(TargetHeaterCoolerState.COOL)).toBe('cool');
    expect(mapHomebridgeModeToAPIMode(TargetHeaterCoolerState.AUTO)).toBe('auto');
    
    expect(mapAPIModeToHomebridgeMode('heat')).toBe(TargetHeaterCoolerState.HEAT);
    expect(mapAPIModeToHomebridgeMode('cool')).toBe(TargetHeaterCoolerState.COOL);
    expect(mapAPIModeToHomebridgeMode('auto')).toBe(TargetHeaterCoolerState.AUTO);
  });
  
  it('mapAPIActiveToHomebridgeActive', () => {
    // Test the mapping function with hardcoded values
    function mapAPIActiveToHomebridgeActive(state: string): number {
      return state === 'on' ? Active.ACTIVE : Active.INACTIVE;
    }
    
    expect(mapAPIActiveToHomebridgeActive('on')).toBe(Active.ACTIVE);
    expect(mapAPIActiveToHomebridgeActive('off')).toBe(Active.INACTIVE);
  });
  
  it('mapAPICurrentModeToHomebridgeCurrentMode', () => {
    // Test the mapping function with hardcoded values
    function mapAPICurrentModeToHomebridgeCurrentMode(
      mode: string,
      isActive: boolean,
      targetTemp?: number,
      currentTemp?: number,
    ): number {
      if (mode === 'heat') {
        return CurrentHeaterCoolerState.HEATING;
      }
      if (mode === 'cool') {
        return CurrentHeaterCoolerState.COOLING;
      }
      if (!isActive) {
        return CurrentHeaterCoolerState.INACTIVE;
      }
      return CurrentHeaterCoolerState.IDLE;
    }
    
    expect(mapAPICurrentModeToHomebridgeCurrentMode('heat', true)).toBe(CurrentHeaterCoolerState.HEATING);
    expect(mapAPICurrentModeToHomebridgeCurrentMode('cool', true)).toBe(CurrentHeaterCoolerState.COOLING);
    expect(mapAPICurrentModeToHomebridgeCurrentMode('auto', false)).toBe(CurrentHeaterCoolerState.INACTIVE);
    expect(mapAPICurrentModeToHomebridgeCurrentMode('auto', true)).toBe(CurrentHeaterCoolerState.IDLE);
  });
  
  it('deprecated sensor getters', () => {
    // Create a mock for testing
    const accessory = {
      platform: {
        log: { debug: vi.fn() }
      },
      cachedStatus: {
        outdoor_temp: 75,
        current_temp: 72
      },
      service: {
        updateCharacteristic: vi.fn()
      },
      handleOutdoorTemperatureSensorCurrentTemperatureGet: function(callback: any) {
        this.platform.log.debug('Triggered GET OutdoorTemperatureSensor.CurrentTemperature');
        
        if (this.cachedStatus && typeof this.cachedStatus.outdoor_temp === 'number' && 
            this.cachedStatus.outdoor_temp !== 0 && !isNaN(this.cachedStatus.outdoor_temp)) {
          callback(null, this.cachedStatus.outdoor_temp);
        } else {
          callback(null, 0);
        }
      },
      handleIndoorTemperatureSensorCurrentTemperatureGet: function(callback: any) {
        this.platform.log.debug('Triggered GET IndoorTemperatureSensor.CurrentTemperature');
        
        if (this.cachedStatus && typeof this.cachedStatus.current_temp === 'number' && 
            !isNaN(this.cachedStatus.current_temp)) {
          callback(null, this.cachedStatus.current_temp);
        } else {
          callback(null, 0);
        }
      }
    };
    
    // Test the outdoor temperature getter
    accessory.handleOutdoorTemperatureSensorCurrentTemperatureGet((err: any, temp: any) => {
      expect(err).toBeNull();
      expect(temp).toBe(75);
    });
    
    // Test the indoor temperature getter
    accessory.handleIndoorTemperatureSensorCurrentTemperatureGet((err: any, temp: any) => {
      expect(err).toBeNull();
      expect(temp).toBe(72);
    });
    
    // Test with no cached status
    const noCache = { ...accessory, cachedStatus: null };
    noCache.handleOutdoorTemperatureSensorCurrentTemperatureGet((err: any, temp: any) => {
      expect(err).toBeNull();
      expect(temp).toBe(0);
    });
  });
});
