import { vi, it, expect, describe, beforeEach, afterEach } from 'vitest';
import { PlatformAccessory, Service, Characteristic, API } from 'homebridge';
import { TfiacPlatform } from '../platform.js';
import { IndoorTemperatureSensorAccessory } from '../IndoorTemperatureSensorAccessory.js';
import { TfiacDeviceConfig } from '../settings.js';
import { AirConditionerStatus } from '../AirConditionerAPI.js';
import { fahrenheitToCelsius } from '../utils.js';

describe('IndoorTemperatureSensorAccessory - Additional Tests', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let deviceConfig: TfiacDeviceConfig;
  let sensor: IndoorTemperatureSensorAccessory;
  let mockService: any;
  let mockCharacteristic: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockCharacteristic = {
      on: vi.fn().mockReturnThis(),
      onGet: vi.fn().mockReturnThis(),
      onSet: vi.fn().mockReturnThis(),
      value: 25,
      updateValue: vi.fn(),
    };

    mockService = {
      setCharacteristic: vi.fn().mockReturnThis(),
      updateCharacteristic: vi.fn().mockReturnThis(),
      getCharacteristic: vi.fn().mockReturnValue(mockCharacteristic),
      setPrimaryService: vi.fn(),
      UUID: 'temp-sensor-uuid',
    };

    const mockApi = {
      hap: {
        Service: {
          TemperatureSensor: 'TemperatureSensor',
        },
        Characteristic: {
          Name: 'Name',
          CurrentTemperature: 'CurrentTemperature',
          ConfiguredName: 'ConfiguredName',
        },
        Categories: { THERMOSTAT: 'thermostat' },
      },
      platformAccessory: vi.fn(),
    } as unknown as API;

    platform = {
      log: {
        debug: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      },
      Service: mockApi.hap.Service as unknown as typeof Service,
      Characteristic: mockApi.hap.Characteristic as unknown as typeof Characteristic,
      api: mockApi,
      accessories: [],
      config: { devices: [] },
    } as unknown as TfiacPlatform;

    accessory = {
      displayName: 'Test AC',
      UUID: 'test-uuid',
      getService: vi.fn().mockReturnValue(undefined),
      getServiceById: vi.fn().mockReturnValue(undefined),
      addService: vi.fn().mockReturnValue(mockService),
      removeService: vi.fn(),
      context: {},
      category: 'DefaultCategory',
      services: [mockService],
      getServiceByUUIDAndSubType: vi.fn().mockReturnValue(undefined),
    } as unknown as PlatformAccessory;

    deviceConfig = {
      name: 'Test AC',
      ip: '192.168.1.100',
      temperatureCorrection: 0,
      enableIndoorTempSensor: true,
      enableTemperature: true,
    };

    sensor = new IndoorTemperatureSensorAccessory(platform, accessory, deviceConfig);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should handle setPrimaryService when available', () => {
    accessory.getServiceById = vi.fn().mockReturnValue(mockService);
    sensor = new IndoorTemperatureSensorAccessory(platform, accessory, deviceConfig);
    // @ts-ignore
    sensor['ensureService']();
    expect(mockService.setPrimaryService).toHaveBeenCalledWith(false);
  });

  it('should handle ConfiguredName when available', () => {
    accessory.getServiceById = vi.fn().mockReturnValue(mockService);
    sensor = new IndoorTemperatureSensorAccessory(platform, accessory, deviceConfig);
    // @ts-ignore
    sensor['ensureService']();
    expect(mockService.setCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.ConfiguredName,
      'Indoor Temperature'
    );
  });

  it('should handle errors from setCharacteristic gracefully', () => {
    mockService.setCharacteristic.mockImplementationOnce(() => {
      throw new Error('Failed to set characteristic');
    });
    accessory.addService = vi.fn().mockReturnValue(mockService);
    expect(() => new IndoorTemperatureSensorAccessory(platform, accessory, deviceConfig)).not.toThrow();
    expect(platform.log.debug).toHaveBeenCalledWith(
      expect.stringContaining('Error configuring indoor temperature sensor:'),
      expect.any(Error)
    );
  });

  it('should skip updates when the service is disabled', () => {
    deviceConfig.enableIndoorTempSensor = false;
    sensor = new IndoorTemperatureSensorAccessory(platform, accessory, deviceConfig);
    const status: AirConditionerStatus = {
      current_temp: 70,
      is_on: 'on',
      operation_mode: 'cool',
      target_temp: 70,
      fan_mode: 'auto',
      swing_mode: 'off',
    };
    sensor.updateStatus(status);
    expect(platform.log.debug).toHaveBeenCalledWith('[IndoorTemperatureSensor] Not enabled, skipping update.');
    expect(mockService.updateCharacteristic).not.toHaveBeenCalled();
  });

  it('should apply temperature correction', () => {
    deviceConfig.temperatureCorrection = 2;
    accessory.getServiceById = vi.fn().mockReturnValue(mockService);
    sensor = new IndoorTemperatureSensorAccessory(platform, accessory, deviceConfig);
    const status: AirConditionerStatus = {
      current_temp: 70,
      is_on: 'on',
      operation_mode: 'cool',
      target_temp: 70,
      fan_mode: 'auto',
      swing_mode: 'off',
    };
    sensor.updateStatus(status);
    const expectedTemp = fahrenheitToCelsius(70) + 2;
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.CurrentTemperature,
      expectedTemp
    );
  });

  it('should use default temperature when current_temp is invalid', () => {
    accessory.getServiceById = vi.fn().mockReturnValue(mockService);
    sensor = new IndoorTemperatureSensorAccessory(platform, accessory, deviceConfig);
    const status: AirConditionerStatus = {
      current_temp: NaN,
      is_on: 'on',
      operation_mode: 'cool',
      target_temp: 70,
      fan_mode: 'auto',
      swing_mode: 'off',
    };
    sensor.updateStatus(status);
    const expectedTemp = 20 + (deviceConfig.temperatureCorrection || 0);
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.CurrentTemperature,
      expectedTemp
    );
  });

  it('should use default temperature when current_temp is missing', () => {
    accessory.getServiceById = vi.fn().mockReturnValue(mockService);
    sensor = new IndoorTemperatureSensorAccessory(platform, accessory, deviceConfig);
    const status: Partial<AirConditionerStatus> = {
      is_on: 'on',
      operation_mode: 'cool',
      target_temp: 70,
      fan_mode: 'auto',
      swing_mode: 'off',
    };
    sensor.updateStatus(status as AirConditionerStatus);
    const expectedTemp = 20 + (deviceConfig.temperatureCorrection || 0);
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.CurrentTemperature,
      expectedTemp
    );
  });

  it('should handle test environment properly', () => {
    const minimalPlatform = {
      log: { debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() },
      Service: { TemperatureSensor: 'TempSensor' },
      Characteristic: { Name: 'Name', CurrentTemperature: 'CurrentTemp', ConfiguredName: 'ConfigName' },
      api: { hap: { Service: {}, Characteristic: {} } },
    } as unknown as TfiacPlatform;
    sensor = new IndoorTemperatureSensorAccessory(minimalPlatform, accessory, deviceConfig);
    // @ts-ignore
    const service = sensor['ensureService']();
    expect(service).toBeDefined();
  });

  it('should properly remove the service', () => {
    accessory.getServiceById = vi.fn().mockReturnValue(mockService);
    sensor = new IndoorTemperatureSensorAccessory(platform, accessory, deviceConfig);
    // @ts-ignore
    sensor['service'] = mockService;
    sensor.removeService();
    expect(accessory.removeService).toHaveBeenCalledWith(mockService);
    // @ts-ignore
    expect(sensor['service']).toBeUndefined();
  });

  it('should gracefully handle removeService when service is undefined', () => {
    sensor = new IndoorTemperatureSensorAccessory(platform, accessory, deviceConfig);
    // @ts-ignore
    sensor['service'] = undefined;
    expect(() => sensor.removeService()).not.toThrow();
    expect(accessory.removeService).not.toHaveBeenCalled();
  });

  it('should handle case where platform Service/Characteristic is undefined', () => {
    const incompletePlatform = {
      log: { debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() },
      Service: undefined,
      Characteristic: undefined,
      api: { hap: { Service: {}, Characteristic: {} } },
    } as unknown as TfiacPlatform;

    sensor = new IndoorTemperatureSensorAccessory(incompletePlatform, accessory, deviceConfig);
    // @ts-ignore
    const service = sensor['ensureService']();
    expect(service).toBeUndefined();

    const status: AirConditionerStatus = {
      current_temp: 70,
      is_on: 'on',
      operation_mode: 'cool',
      target_temp: 70,
      fan_mode: 'auto',
      swing_mode: 'off',
    };
    expect(() => sensor.updateStatus(status)).not.toThrow();
  });

  it('should handle temperature disabled via enableTemperature flag', () => {
    deviceConfig.enableTemperature = false;
    sensor = new IndoorTemperatureSensorAccessory(platform, accessory, deviceConfig);
    // @ts-ignore
    const service = sensor['ensureService']();
    expect(service).toBeUndefined();

    const status: AirConditionerStatus = {
      current_temp: 70,
      is_on: 'on',
      operation_mode: 'cool',
      target_temp: 70,
      fan_mode: 'auto',
      swing_mode: 'off',
    };
    sensor.updateStatus(status);
    expect(mockService.updateCharacteristic).not.toHaveBeenCalled();
  });

  it('should reuse existing service if already created', () => {
    accessory.getServiceById = vi.fn().mockReturnValue(mockService);
    // Initialize the sensor which might call ensureService internally if a service doesn't exist.
    sensor = new IndoorTemperatureSensorAccessory(platform, accessory, deviceConfig);
    
    // Clear mock calls that might have happened during initialization
    vi.clearAllMocks(); 
    // Re-mock getServiceById to ensure it returns the service for subsequent calls within ensureService
    accessory.getServiceById = vi.fn().mockReturnValue(mockService);

    // @ts-ignore
    const service1 = sensor['ensureService']();
    // @ts-ignore
    const service2 = sensor['ensureService']();
    
    // addService should not be called if the service is found by getServiceById
    expect(accessory.addService).toHaveBeenCalledTimes(0);
    expect(service1).toBe(mockService);
    expect(service2).toBe(mockService);
  });
});
