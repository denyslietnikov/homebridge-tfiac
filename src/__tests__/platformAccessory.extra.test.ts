import { PlatformAccessory, Service } from 'homebridge';
import { TfiacPlatformAccessory } from '../platformAccessory.js';
import type { TfiacPlatform } from '../platform.js';
import { AirConditionerStatus } from '../AirConditionerAPI.js';

describe('TfiacPlatformAccessory extra tests', () => {
  let platform: Partial<TfiacPlatform>;
  let accessory: Partial<PlatformAccessory>;
  let service: any;

  beforeEach(() => {
    // Stub service with characteristic storage
    const charStore: Record<string, any> = {};
    service = {
      updateCharacteristic: jest.fn((char, val) => { charStore[char] = val; }),
      getCharacteristic: jest.fn((char) => ({ value: charStore[char], on: jest.fn() })),
      setCharacteristic: jest.fn(),
    };
    // Stub accessory
    accessory = {
      context: { deviceConfig: { name: 'AC', ip: '1', updateInterval: 1 } },
      getService: jest.fn().mockReturnValue(service),
      addService: jest.fn().mockReturnValue(service),
      getServiceById: jest.fn(),
      removeService: jest.fn(),
    };
    // Stub platform
    platform = {
      Service: { HeaterCooler: 'HeaterCooler', TemperatureSensor: 'TemperatureSensor' },
      Characteristic: {
        Name: 'Name', Active: { ACTIVE: 1, INACTIVE: 0 },
        CurrentHeaterCoolerState: { IDLE: 0, COOLING: 2, HEATING: 1 },
        TargetHeaterCoolerState: { AUTO: 0, COOL: 1, HEAT: 2 },
        CurrentTemperature: 'CurrentTemperature',
        CoolingThresholdTemperature: 'CoolingThresholdTemperature',
        HeatingThresholdTemperature: 'HeatingThresholdTemperature',
        RotationSpeed: 'RotationSpeed', SwingMode: 'SwingMode',
      },
      log: { debug: jest.fn(), info: jest.fn(), error: jest.fn() },
      api: { hap: { Characteristic: { TemperatureDisplayUnits: { FAHRENHEIT: 1 } } } },
    } as any;
  });

  it('should remove sensors when disable temperature', () => {
    accessory.context!.deviceConfig.enableTemperature = false;
    // Provide existing sensor services
    accessory.getServiceById = jest.fn()
      .mockReturnValueOnce({}) // indoor
      .mockReturnValueOnce({}); // outdoor

    new TfiacPlatformAccessory(platform as TfiacPlatform, accessory as PlatformAccessory);
    expect(platform.log!.info).toHaveBeenCalledWith('Temperature sensors are disabled for AC');
    expect(accessory.removeService).toHaveBeenCalledTimes(2);
    expect(platform.log!.debug).toHaveBeenCalledWith('Removed existing indoor temperature sensor service.');
    expect(platform.log!.debug).toHaveBeenCalledWith('Removed existing outdoor temperature sensor service.');
  });

  it('stopPolling clears timers and calls cleanup', () => {
    const inst = new TfiacPlatformAccessory(platform as TfiacPlatform, accessory as PlatformAccessory);
    // attach fake timers
    (inst as any).warmupTimeout = setTimeout(() => {}, 1000) as any;
    (inst as any).pollingInterval = setInterval(() => {}, 1000) as any;
    // stub api.cleanup
    inst['deviceAPI'].cleanup = jest.fn();
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
      platform.Characteristic!.RotationSpeed,
      50,
    );
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic!.SwingMode,
      0,
    );
  });

  it('updateHeaterCoolerCharacteristics sets values on non-null status', () => {
    const inst = new TfiacPlatformAccessory(platform as TfiacPlatform, accessory as PlatformAccessory);
    const status: AirConditionerStatus = {
      is_on: 'on', operation_mode: 'heat', current_temp: 212,
      target_temp: 212, fan_mode: 'High', swing_mode: 'Both',
    };
    (inst as any).updateHeaterCoolerCharacteristics(status);
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic!.Active,
      platform.Characteristic!.Active.ACTIVE,
    );
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic!.CurrentHeaterCoolerState,
      platform.Characteristic!.CurrentHeaterCoolerState.HEATING,
    );
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic!.TargetHeaterCoolerState,
      platform.Characteristic!.TargetHeaterCoolerState.HEAT,
    );
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
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic!.RotationSpeed,
      75,
    );
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic!.SwingMode,
      1,
    );
  });

  it('map and handler functions behave correctly', () => {
    const inst = new TfiacPlatformAccessory(platform as TfiacPlatform, accessory as PlatformAccessory);
    expect(inst['mapOperationModeToCurrentHeaterCoolerState']('cool')).toBe(2);
    expect(inst['mapOperationModeToCurrentHeaterCoolerState']('heat')).toBe(1);
    expect(inst['mapOperationModeToCurrentHeaterCoolerState']('other')).toBe(0);

    expect(inst['mapFanModeToRotationSpeed']('Low')).toBe(25);
    expect(inst['mapFanModeToRotationSpeed']('X')).toBe(50);
    expect(inst['mapRotationSpeedToFanMode'](10)).toBe('Low');
    expect(inst['mapRotationSpeedToFanMode'](60)).toBe('High');

    expect(inst.fahrenheitToCelsius(32)).toBe(0);
    expect(inst.celsiusToFahrenheit(0)).toBe(32);

    // test compatibility handler fallback
    const h = inst.getCharacteristicHandler('Active', 'get');
    expect(h).toBeDefined();
    const h2 = inst.getCharacteristicHandler('Unknown', 'get');
    expect(h2).toBeUndefined();
  });

  it('getCharacteristicHandler fallback covers all mapped cases', () => {
    const inst = new TfiacPlatformAccessory(platform as TfiacPlatform, accessory as PlatformAccessory);
    const keys: Array<[string, 'get' | 'set']> = [
      ['CurrentTemperature', 'get'],
      ['CoolingThresholdTemperature', 'get'],
      ['HeatingThresholdTemperature', 'get'],
      ['CoolingThresholdTemperature', 'set'],
      ['RotationSpeed', 'get'],
      ['RotationSpeed', 'set'],
      ['SwingMode', 'get'],
      ['SwingMode', 'set'],
      ['Active', 'get'],
      ['Active', 'set'],
      ['CurrentHeaterCoolerState', 'get'],
      ['TargetHeaterCoolerState', 'get'],
      ['TargetHeaterCoolerState', 'set'],
    ];
    for (const [char, event] of keys) {
      const handler = inst.getCharacteristicHandler(char, event);
      expect(handler).toBeDefined();
      expect(typeof handler).toBe('function');
    }
  });
});
