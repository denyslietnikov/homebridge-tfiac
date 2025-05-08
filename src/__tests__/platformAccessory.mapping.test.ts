import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TfiacPlatformAccessory } from '../platformAccessory.js';
import { OperationMode, PowerState, FanSpeed } from '../enums.js';

// Mock platform with minimal Characteristic and Service definitions
const mockPlatform: any = {
  Characteristic: {
    CurrentHeaterCoolerState: { HEATING: 1, COOLING: 2, IDLE: 0 },
    TargetHeaterCoolerState: { HEAT: 1, COOL: 2, AUTO: 3 },
    Active: { ACTIVE: 1, INACTIVE: 0 },
    SwingMode: { SWING_ENABLED: 1 },
    TemperatureDisplayUnits: { FAHRENHEIT: 1, CELSIUS: 0 },
    RotationSpeed: "RotationSpeed",
  },
  Service: { HeaterCooler: {}, TemperatureSensor: { UUID: 'temp-sensor' }, Switch: {} },
  api: { hap: { Characteristic: {
      CurrentHeaterCoolerState: { HEATING: 1, COOLING: 2, IDLE: 0 },
      TargetHeaterCoolerState: { HEAT: 1, COOL: 2, AUTO: 3 },
      Active: { ACTIVE: 1, INACTIVE: 0 },
      SwingMode: { SWING_ENABLED: 1 },
      TemperatureDisplayUnits: { FAHRENHEIT: 1, CELSIUS: 0 },
      RotationSpeed: "RotationSpeed",
    } } },
  config: { debug: false },
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn() },
};

// Minimal accessory mock
const mockAccessory: any = {
  context: { deviceConfig: { updateInterval: 1, name: 'Test AC', enableIndoorTempSensor: true, enableOutdoorTempSensor: true, ip: '1.2.3.4' } },
  services: [],
  getService: () => undefined,
  addService: () => ({ setCharacteristic: () => {}, getCharacteristic: () => ({ onGet: () => {}, onSet: () => {}, value: null }) }),
  removeService: () => {},
};

let inst: any;
beforeEach(() => {
  inst = new TfiacPlatformAccessory(() => mockPlatform, mockAccessory);
});

describe('TfiacPlatformAccessory mapping methods', () => {
  it('mapAPIActiveToHomebridgeActive', () => {
    expect(inst.mapAPIActiveToHomebridgeActive(PowerState.On)).toBe(mockPlatform.Characteristic.Active.ACTIVE);
    expect(inst.mapAPIActiveToHomebridgeActive(PowerState.Off)).toBe(mockPlatform.Characteristic.Active.INACTIVE);
  });

  it('mapHomebridgeModeToAPIMode', () => {
    const C = mockPlatform.Characteristic.TargetHeaterCoolerState;
    expect(inst.mapHomebridgeModeToAPIMode(C.HEAT)).toBe(OperationMode.Heat);
    expect(inst.mapHomebridgeModeToAPIMode(C.COOL)).toBe(OperationMode.Cool);
    expect(inst.mapHomebridgeModeToAPIMode(999)).toBe(OperationMode.Auto);
  });

  it('mapAPIModeToHomebridgeMode', () => {
    const C = mockPlatform.Characteristic.TargetHeaterCoolerState;
    expect(inst.mapAPIModeToHomebridgeMode(OperationMode.Heat)).toBe(C.HEAT);
    expect(inst.mapAPIModeToHomebridgeMode(OperationMode.Cool)).toBe(C.COOL);
    expect(inst.mapAPIModeToHomebridgeMode(OperationMode.Auto)).toBe(C.AUTO);
  });

  it('mapAPICurrentModeToHomebridgeCurrentMode Auto compares temps', () => {
    const status = { operation_mode: OperationMode.Auto, is_on: PowerState.On, target_temp: 80, current_temp: 60 };
    expect(inst.mapAPICurrentModeToHomebridgeCurrentMode(status.operation_mode, status.is_on, status.target_temp, status.current_temp)).toBe(mockPlatform.Characteristic.CurrentHeaterCoolerState.HEATING);
    expect(inst.mapAPICurrentModeToHomebridgeCurrentMode(status.operation_mode, PowerState.Off)).toBe(mockPlatform.Characteristic.CurrentHeaterCoolerState.IDLE);
  });

  it('mapFanModeToRotationSpeed and back', () => {
    expect(inst.mapFanModeToRotationSpeed(FanSpeed.Low)).toBeLessThanOrEqual(100);
    expect(inst.mapRotationSpeedToFanMode(50)).toBeDefined();
  });
});

describe('mapAPICurrentModeToHomebridgeCurrentMode', () => {
  it('handles Auto when off', () => {
    const val = inst['mapAPICurrentModeToHomebridgeCurrentMode'](OperationMode.Auto, PowerState.Off);
    expect(val).toBe(mockPlatform.Characteristic.CurrentHeaterCoolerState.IDLE);
  });

  it('handles Auto on heating and cooling', () => {
    const HCS = mockPlatform.Characteristic.CurrentHeaterCoolerState;
    expect(inst['mapAPICurrentModeToHomebridgeCurrentMode'](OperationMode.Auto, PowerState.On, 50, 60)).toBe(HCS.COOLING);
    expect(inst['mapAPICurrentModeToHomebridgeCurrentMode'](OperationMode.Auto, PowerState.On, 60, 50)).toBe(HCS.HEATING);
    expect(inst['mapAPICurrentModeToHomebridgeCurrentMode'](OperationMode.Auto, PowerState.On, 50, 50)).toBe(HCS.IDLE);
  });
});

describe('temperature conversions', () => {
  it('converts Celsius to Fahrenheit and back', () => {
    const CDU = mockPlatform.Characteristic.TemperatureDisplayUnits;
    const display = inst['convertTemperatureToDisplay'](0, CDU.FAHRENHEIT);
    expect(display).toBe(32);
    const back = inst['convertTemperatureFromDisplay'](32, CDU.FAHRENHEIT);
    expect(back).toBe(0);
  });
});

describe('outdoor temperature sensor get', () => {
  it('returns celsius value for cached status', async () => {
    inst.cachedStatus = { outdoor_temp: 212 };
    const val = await inst.handleOutdoorTemperatureSensorCurrentTemperatureGet();
    expect(val).toBe(100);
  });

  it('uses callback style', async () => {
    inst.cachedStatus = { outdoor_temp: 0 };
    const val = await new Promise<number>((resolve, reject) => {
      inst.handleOutdoorTemperatureSensorCurrentTemperatureGet((err: Error | null, v?: number) => {
        if (err) return reject(err);
        resolve(v as number);
      });
    });
    expect(val).toBe(20);
  });
});

describe('indoor temperature sensor get', () => {
  it('returns celsius for cached status', async () => {
    inst.cachedStatus = { current_temp: 212 };
    const val = await inst.handleTemperatureSensorCurrentTemperatureGet();
    expect(val).toBe(100);
  });

  it('callback style returns default', async () => {
    inst.cachedStatus = null;
    const val = await new Promise<number>((resolve, reject) => {
      inst.handleTemperatureSensorCurrentTemperatureGet((err: Error | null, v?: number) => {
        if (err) return reject(err);
        resolve(v as number);
      });
    });
    expect(val).toBe(20);
  });
});

describe('handleActiveSet skip logic', () => {
  it('skips turnOn if device already on', async () => {
    inst.cachedStatus = { is_on: PowerState.On };
    inst['deviceAPI'].turnOn = vi.fn();
    inst['deviceAPI'].turnOff = vi.fn();
    inst['cacheManager'] = { clear: vi.fn() };
    inst['updateCachedStatus'] = vi.fn(); // stub to avoid hanging
    await inst.handleActiveSet(mockPlatform.Characteristic.Active.ACTIVE);
    expect(inst['deviceAPI'].turnOn).not.toHaveBeenCalled();
  });
});