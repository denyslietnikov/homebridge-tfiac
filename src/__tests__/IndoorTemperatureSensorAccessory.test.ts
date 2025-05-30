import { vi, it, expect, describe, beforeEach, afterEach } from 'vitest';
import { PlatformAccessory, Service } from 'homebridge';
import { TfiacPlatform } from '../platform.js';
import { IndoorTemperatureSensorAccessory } from '../IndoorTemperatureSensorAccessory.js';
import { TfiacDeviceConfig } from '../settings.js';
import { PowerState } from '../enums.js'; // Import Enum

describe('IndoorTemperatureSensorAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let deviceConfig: TfiacDeviceConfig;
  let sensorAccessory: IndoorTemperatureSensorAccessory;
  let mockService: any;

  beforeEach(() => {
    // Mock service
    mockService = {
      setCharacteristic: vi.fn().mockReturnThis(),
      getCharacteristic: vi.fn().mockReturnValue({
        on: vi.fn().mockReturnThis(),
        value: 20,
      }),
      updateCharacteristic: vi.fn(),
    };

    // Mock platform
    platform = {
      log: {
        debug: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
      },
      Service: {
        TemperatureSensor: vi.fn(),
      },
      Characteristic: {
        Name: 'Name',
        CurrentTemperature: 'CurrentTemperature',
      },
    } as unknown as TfiacPlatform;

    // Mock device config
    deviceConfig = {
      name: 'Test Device',
      ip: '192.168.1.100',
      port: 8080,
      updateInterval: 30,
    };

    // Mock accessory
    accessory = {
      context: { deviceConfig },
      getServiceById: vi.fn().mockReturnValue(null),
      addService: vi.fn().mockReturnValue(mockService),
      removeService: vi.fn(),
    } as unknown as PlatformAccessory;

    // Create the accessory
    sensorAccessory = new IndoorTemperatureSensorAccessory(platform, accessory, deviceConfig);
  });

  it('should create an instance', () => {
    expect(sensorAccessory).toBeDefined();
  });

  it('should add a new service if none exists', () => {
    expect(accessory.getServiceById).toHaveBeenCalledWith(
      platform.Service.TemperatureSensor,
      'indoor_temperature'
    );
    expect(accessory.addService).toHaveBeenCalledWith(
      platform.Service.TemperatureSensor,
      'Indoor Temperature',
      'indoor_temperature'
    );
    expect(mockService.setCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.Name,
      'Indoor Temperature'
    );
  });

  it('should use existing service if available', () => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Mock an existing service
    const existingService = {
      setCharacteristic: vi.fn().mockReturnThis(),
      getCharacteristic: vi.fn().mockReturnValue({
        on: vi.fn().mockReturnThis(),
        value: 22,
      }),
      updateCharacteristic: vi.fn(),
    };
    
    (accessory.getServiceById as ReturnType<typeof vi.fn>).mockReturnValue(existingService);
    
    // Create new instance with existing service
    const newAccessory = new IndoorTemperatureSensorAccessory(platform, accessory, deviceConfig);
    
    expect(accessory.getServiceById).toHaveBeenCalledWith(
      platform.Service.TemperatureSensor,
      'indoor_temperature'
    );
    expect(accessory.addService).not.toHaveBeenCalled();
    expect(existingService.setCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.Name,
      'Indoor Temperature'
    );
  });

  it('should update temperature when updateStatus is called with valid status', () => {
    const status = {
      current_temp: 77, // Fahrenheit (25°C)
      target_temp: 70,
      operation_mode: 'cool',
      fan_mode: 'Auto',
      is_on: PowerState.On, // Use Enum
      swing_mode: 'off',
    };
    
    sensorAccessory.updateStatus(status);
    
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.CurrentTemperature,
      25 // Expected Celsius temperature
    );
  });

  it('should set default temperature when updateStatus is called with null', () => {
    sensorAccessory.updateStatus(null);
    
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.CurrentTemperature,
      20 // Default temperature
    );
  });

  it('should remove the service when removeService is called', () => {
    sensorAccessory.removeService();
    
    expect(platform.log.info).toHaveBeenCalled();
    expect(accessory.removeService).toHaveBeenCalledWith(mockService);
  });

  it('should skip update when sensor disabled', () => {
    mockService.updateCharacteristic.mockClear();
    deviceConfig.enableIndoorTempSensor = false;
    sensorAccessory = new IndoorTemperatureSensorAccessory(platform, accessory, deviceConfig);
    sensorAccessory.updateStatus({ current_temp: 80 } as any);
    expect(platform.log.debug).toHaveBeenCalledWith(
      '[IndoorTemperatureSensor] Not enabled, skipping update.'
    );
    expect(mockService.updateCharacteristic).not.toHaveBeenCalled();
  });

  it('should apply temperature correction', () => {
    mockService.updateCharacteristic.mockClear();
    deviceConfig.temperatureCorrection = 2;
    sensorAccessory = new IndoorTemperatureSensorAccessory(platform, accessory, deviceConfig);
    sensorAccessory.updateStatus({ current_temp: 68 } as any); // 20°C expected + 2 = 22
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.CurrentTemperature,
      20 + 2
    );
  });

  it('should use default on invalid temperature', () => {
    mockService.updateCharacteristic.mockClear();
    sensorAccessory.updateStatus({ current_temp: NaN } as any);
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.CurrentTemperature,
      20
    );
  });

  it('should use fallback _testUpdateCharacteristic when updateCharacteristic missing', () => {
    // Mock existing service without updateCharacteristic
    const existingService: any = {
      setCharacteristic: vi.fn().mockReturnThis(),
      getCharacteristic: vi.fn().mockReturnValue({ on: vi.fn(), value: 100 }),
      _testUpdateCharacteristic: vi.fn(),
    };
    (accessory.getServiceById as ReturnType<typeof vi.fn>).mockReturnValue(existingService);
    sensorAccessory = new IndoorTemperatureSensorAccessory(platform, accessory, deviceConfig);
    sensorAccessory.updateStatus({ current_temp: 86 } as any); // 86°F -> 30°C
    expect(existingService._testUpdateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.CurrentTemperature,
      30,
    );
  });

  it('should skip update when platform.Service is missing', () => {
    platform.Service = undefined as any;
    mockService.updateCharacteristic.mockClear();
    sensorAccessory.updateStatus({ current_temp: 77 } as any);
    expect(mockService.updateCharacteristic).not.toHaveBeenCalled();
  });

  it('should not remove service when none exists', () => {
    // Ensure service undefined
    (sensorAccessory as any).service = undefined;
    sensorAccessory.removeService();
    expect(accessory.removeService).not.toHaveBeenCalled();
  });

  it('should not create service when enableTemperature is false', () => {
    deviceConfig.enableTemperature = false;
    const newSensor = new IndoorTemperatureSensorAccessory(platform, accessory, deviceConfig);
    expect((newSensor as any).service).toBeUndefined();
  });
});
