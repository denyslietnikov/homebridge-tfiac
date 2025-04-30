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
      setCharacteristic: jest.fn().mockReturnThis(),
      getCharacteristic: jest.fn().mockReturnValue({
        on: jest.fn().mockReturnThis(),
        value: 20,
      }),
      updateCharacteristic: jest.fn(),
    };

    // Mock platform
    platform = {
      log: {
        debug: jest.fn(),
        info: jest.fn(),
        error: jest.fn(),
      },
      Service: {
        TemperatureSensor: jest.fn(),
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
      getServiceById: jest.fn().mockReturnValue(null),
      addService: jest.fn().mockReturnValue(mockService),
      removeService: jest.fn(),
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
    jest.clearAllMocks();
    
    // Mock an existing service
    const existingService = {
      setCharacteristic: jest.fn().mockReturnThis(),
      getCharacteristic: jest.fn().mockReturnValue({
        on: jest.fn().mockReturnThis(),
        value: 22,
      }),
      updateCharacteristic: jest.fn(),
    };
    
    (accessory.getServiceById as jest.Mock).mockReturnValue(existingService);
    
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
});
