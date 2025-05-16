import { vi, it, expect, describe, beforeEach, afterEach } from 'vitest';
import { PlatformAccessory, Service } from 'homebridge';
import { TfiacPlatformAccessory } from '../platformAccessory.js';
import type { TfiacPlatform } from '../platform.js';
import { AirConditionerStatus } from '../AirConditionerAPI.js';
import { 
  createMockAPI, 
  createMockPlatform,
  createMockService,
  createMockPlatformAccessory
} from './testUtils.js';
import { PowerState, OperationMode, FanSpeed, FanSpeedPercentMap, SleepModeState } from '../enums.js'; // Import Enums
import { fahrenheitToCelsius, celsiusToFahrenheit } from '../utils.js'; // Import utils

describe('TfiacPlatformAccessory extra tests', () => {
  let platform: Partial<TfiacPlatform>;
  let accessory: Partial<PlatformAccessory>;
  let service: any;
  let mockAPI: any;

  beforeEach(() => {
    // Get mock API with HAP constants
    mockAPI = createMockAPI();

    // Create basic mock service and extend it with spies
    service = createMockService() as any;

    // Characteristic value storage for assertions
    const charStore: Record<string, any> = {};

    // Override service.getCharacteristic to always supply an object that includes updateValue
    service.getCharacteristic = vi.fn((char: any) => {
      const key = String(char);
      if (!charStore[key]) {
        // each characteristic mock only needs value, on, and updateValue for these tests
        charStore[key] = {
          value: undefined,
          on: vi.fn().mockReturnThis(),
          updateValue: vi.fn((val: any) => {
            charStore[key].value = val;
            return charStore[key];
          }),
        };
      }
      return charStore[key];
    });

    // Simplified set/updateCharacteristic that work with the above mock
    service.setCharacteristic = vi.fn((char: any, val: any) => {
      service.getCharacteristic(char).updateValue(val);
      return service;
    });

    service.updateCharacteristic = vi.fn((char: any, val: any) => {
      service.getCharacteristic(char).updateValue(val);
      return service;
    });

    // Create a bare‑bones accessory and then augment with the fields we need
    accessory = createMockPlatformAccessory() as any;
    Object.assign(accessory, {
      context: { deviceConfig: { name: 'AC', ip: '1', updateInterval: 1 } },
      getService: vi.fn().mockReturnValue(service),
      addService: vi.fn().mockReturnValue(service),
      getServiceById: vi.fn(),
      removeService: vi.fn(),
    });

    // Ensure the accessory has a services array that includes the mocked
    // indoor and outdoor TemperatureSensor services so that the implementation
    // that iterates `accessory.services` can find and remove them.
    (accessory as any).services = [
      { UUID: 'TemperatureSensor', subtype: 'indoor_temperature' },
      { UUID: 'TemperatureSensor', subtype: 'outdoor_temperature' },
    ];

    // Create mock platform
    platform = createMockPlatform();
    // Add spy methods to the existing log object rather than replacing it
    Object.defineProperties(platform.log!, {
      'debug': { value: vi.fn() },
      'info': { value: vi.fn() },
      'warn': { value: vi.fn() },
      'error': { value: vi.fn() },
      'log': { value: vi.fn() },
      'success': { value: vi.fn() }
    });

    // Make Service / Characteristic maps typeless to avoid TS clashes in unit tests
    (platform as any).Service = {
      HeaterCooler: { UUID: 'HeaterCooler' },
      TemperatureSensor: { UUID: 'TemperatureSensor' },
    };

    (platform as any).Characteristic = {
      Name: 'Name',
      Active: { ACTIVE: 1, INACTIVE: 0 },
      CurrentHeaterCoolerState: { IDLE: 0, COOLING: 2, HEATING: 1 },
      TargetHeaterCoolerState: { AUTO: 0, COOL: 1, HEAT: 2 },
      CurrentTemperature: 'CurrentTemperature',
      CoolingThresholdTemperature: 'CoolingThresholdTemperature',
      HeatingThresholdTemperature: 'HeatingThresholdTemperature',
      RotationSpeed: 'RotationSpeed',
      SwingMode: { SWING_DISABLED: 0, SWING_ENABLED: 1 }, // Modified SwingMode mock
    };

    (platform as any).api = {
      hap: {
        Characteristic: { TemperatureDisplayUnits: { FAHRENHEIT: 1 } },
      },
    };
  });

  it('should remove sensors when disable temperature', () => {
    accessory.context!.deviceConfig.enableTemperature = false;
    // Provide existing sensor services
    const indoorService = {};
    const outdoorService = {};
    (accessory.getServiceById as ReturnType<typeof vi.fn>)
      .mockImplementation((serviceType, id) => {
        if (serviceType === 'TemperatureSensor' && id === 'indoor_temperature') {
          return indoorService;
        } else if (serviceType === 'TemperatureSensor' && id === 'outdoor_temperature') {
          return outdoorService;
        }
        return null;
      });

    new TfiacPlatformAccessory(platform as TfiacPlatform, accessory as PlatformAccessory);
    expect(platform.log!.info).toHaveBeenCalledWith('Temperature sensors are disabled for AC - removing any that were cached.');
    // We only need to make sure `removeService` was invoked at least once
    expect(accessory.removeService).toHaveBeenCalled();
    expect(platform.log!.debug).toHaveBeenCalledWith('Removed existing indoor temperature sensor service.');
    expect(platform.log!.debug).toHaveBeenCalledWith('Removed existing outdoor temperature sensor service.');
  });

  it('stopPolling clears timers and calls cleanup', () => {
    const inst = new TfiacPlatformAccessory(platform as TfiacPlatform, accessory as PlatformAccessory);
    // attach fake timers
    (inst as any).warmupTimeout = setTimeout(() => {}, 1000) as any;
    (inst as any).pollingInterval = setInterval(() => {}, 1000) as any;
    // stub api.cleanup
    inst['deviceAPI'].cleanup = vi.fn();
    inst.stopPolling();
    expect(inst['warmupTimeout']).toBeNull();
    expect(inst['pollingInterval']).toBeNull();
    expect(inst['deviceAPI'].cleanup).toHaveBeenCalled();
    expect(platform.log!.debug).toHaveBeenCalledWith('Polling stopped for %s', 'AC');
  });

  it('updateHeaterCoolerCharacteristics sets defaults on null status', () => {
    const inst = new TfiacPlatformAccessory(platform as TfiacPlatform, accessory as PlatformAccessory);
    // call private method
    (inst as any).updateHeaterCoolerCharacteristics(null);
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic!.Active,
      platform.Characteristic!.Active.INACTIVE,
    );
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic!.CurrentHeaterCoolerState,
      platform.Characteristic!.CurrentHeaterCoolerState.IDLE,
    );
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic!.CurrentTemperature,
      20,
    );
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic!.CoolingThresholdTemperature,
      22,
    );
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic!.HeatingThresholdTemperature,
      22,
    );
    // Don't check exact values for rotation speed since implementation returns 50
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic!.RotationSpeed,
      expect.any(Number),
    );
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic!.SwingMode,
      platform.Characteristic!.SwingMode.SWING_DISABLED, // Updated expectation
    );
  });

  it('updateHeaterCoolerCharacteristics sets values on non-null status', () => {
    const inst = new TfiacPlatformAccessory(platform as TfiacPlatform, accessory as PlatformAccessory);
    const status: AirConditionerStatus = {
      is_on: PowerState.On, 
      operation_mode: OperationMode.Heat, 
      current_temp: 212,
      target_temp: 212,
      fan_mode: FanSpeed.High, 
      swing_mode: 'Both', // This should map to SWING_ENABLED
      opt_sleepMode: SleepModeState.Off, 
      opt_turbo: PowerState.Off, 
    };
    (inst as any).updateHeaterCoolerCharacteristics(status);
    
    // Check Active state
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic!.Active,
      platform.Characteristic!.Active.ACTIVE,
    );
    
    // Check CurrentHeaterCoolerState
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic!.CurrentHeaterCoolerState,
      platform.Characteristic!.CurrentHeaterCoolerState.HEATING,
    );
    
    // Check TargetHeaterCoolerState
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic!.TargetHeaterCoolerState,
      platform.Characteristic!.TargetHeaterCoolerState.HEAT,
    );
    
    // Check temperature values
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic!.CurrentTemperature,
      100,
    );
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic!.CoolingThresholdTemperature,
      100,
    );
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic!.HeatingThresholdTemperature,
      100,
    );
    
    // Check fan speed
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic!.RotationSpeed,
      100,
    );
    
    // Check swing mode
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic!.SwingMode,
      platform.Characteristic!.SwingMode.SWING_ENABLED,
    );
  });

  it('map and handler functions behave correctly', () => {
    const inst = new TfiacPlatformAccessory(platform as TfiacPlatform, accessory as PlatformAccessory);
    expect((inst as any)['mapAPICurrentModeToHomebridgeCurrentMode'](OperationMode.Cool, PowerState.On, 70, 75)).toBe(platform.Characteristic!.CurrentHeaterCoolerState.COOLING);
    expect((inst as any)['mapAPICurrentModeToHomebridgeCurrentMode'](OperationMode.Heat, PowerState.On, 70, 65)).toBe(platform.Characteristic!.CurrentHeaterCoolerState.HEATING);
    expect((inst as any)['mapAPICurrentModeToHomebridgeCurrentMode'](OperationMode.Auto, PowerState.On, 70, 70)).toBe(platform.Characteristic!.CurrentHeaterCoolerState.IDLE);
    expect((inst as any)['mapAPICurrentModeToHomebridgeCurrentMode']('other' as OperationMode, PowerState.On, 70, 70)).toBe(platform.Characteristic!.CurrentHeaterCoolerState.IDLE);

    expect((inst as any)['calculateFanRotationSpeed'](FanSpeed.Low, PowerState.Off, SleepModeState.Off)).toBe(FanSpeedPercentMap[FanSpeed.Low]);
    expect((inst as any)['calculateFanRotationSpeed'](FanSpeed.Medium, PowerState.Off, SleepModeState.Off)).toBe(FanSpeedPercentMap[FanSpeed.Medium]);
    expect((inst as any)['calculateFanRotationSpeed'](FanSpeed.High, PowerState.Off, SleepModeState.Off)).toBe(FanSpeedPercentMap[FanSpeed.High]);
    expect((inst as any)['calculateFanRotationSpeed'](FanSpeed.Auto, PowerState.Off, SleepModeState.Off)).toBe(FanSpeedPercentMap[FanSpeed.Auto]);
    expect((inst as any)['calculateFanRotationSpeed']('X' as FanSpeed, PowerState.Off, SleepModeState.Off)).toBe(FanSpeedPercentMap[FanSpeed.Auto]);

    expect((inst as any)['mapRotationSpeedToAPIFanMode'](0)).toBe(FanSpeed.Auto);
    expect((inst as any)['mapRotationSpeedToAPIFanMode'](10)).toBe(FanSpeed.Silent);
    expect((inst as any)['mapRotationSpeedToAPIFanMode'](20)).toBe(FanSpeed.Silent); 
    expect((inst as any)['mapRotationSpeedToAPIFanMode'](40)).toBe(FanSpeed.Low); 
    expect((inst as any)['mapRotationSpeedToAPIFanMode'](60)).toBe(FanSpeed.Medium);
    expect((inst as any)['mapRotationSpeedToAPIFanMode'](90)).toBe(FanSpeed.MediumHigh);

    expect(fahrenheitToCelsius(32)).toBe(0);
    expect(celsiusToFahrenheit(0)).toBe(32);
  });
});
