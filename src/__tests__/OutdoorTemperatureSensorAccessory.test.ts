import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from '../platform.js';
import { OutdoorTemperatureSensorAccessory } from '../OutdoorTemperatureSensorAccessory.js';
import { TfiacDeviceConfig } from '../settings.js';
import { PowerState } from '../enums.js'; // Import Enum
import { 
  setupTestPlatform, 
  createMockPlatformAccessory, 
  createMockService 
} from './testUtils.js';

describe('OutdoorTemperatureSensorAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let deviceConfig: TfiacDeviceConfig;
  let sensorAccessory: OutdoorTemperatureSensorAccessory;
  let mockService: any;

  beforeEach(() => {
    // Setup test platform using the utility function
    platform = setupTestPlatform();
    
    // Create mockService using utility function
    mockService = createMockService();

    // Mock device config
    deviceConfig = {
      name: 'Test Device',
      ip: '192.168.1.100',
      port: 8080,
      updateInterval: 30,
      enableTemperature: true,
    };

    // Create a mock accessory using the utility function
    accessory = createMockPlatformAccessory('Test Device', 'test-uuid', deviceConfig);
    
    // Override the getService mock for this specific test context
    accessory.getService = jest.fn().mockReturnValue(null);
    accessory.addService = jest.fn().mockReturnValue(mockService);

    // Create the accessory
    sensorAccessory = new OutdoorTemperatureSensorAccessory(platform, accessory, deviceConfig);
  });

  it('should create an instance', () => {
    expect(sensorAccessory).toBeDefined();
  });

  it('should not create service in constructor', () => {
    expect(accessory.getService).not.toHaveBeenCalled();
    expect(accessory.addService).not.toHaveBeenCalled();
  });

  it('should add service when updateStatus is called with valid outdoor temperature', () => {
    const status = {
      current_temp: 77,
      target_temp: 70,
      operation_mode: 'cool',
      fan_mode: 'Auto',
      is_on: PowerState.On, // Use Enum
      swing_mode: 'off',
      outdoor_temp: 86, // ~30°C
    };
    
    sensorAccessory.updateStatus(status);
    
    expect(accessory.getService).toHaveBeenCalledWith('Outdoor Temperature');
    expect(accessory.addService).toHaveBeenCalledWith(
      platform.Service.TemperatureSensor,
      'Outdoor Temperature',
      'outdoor_temperature'
    );
    expect(mockService.setCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.Name,
      'Outdoor Temperature'
    );
    expect(mockService.getCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.CurrentTemperature
    );
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.CurrentTemperature,
      30
    );
  });

  it('should use existing service if available', () => {
    // Setup existing service
    (accessory.getService as jest.Mock).mockReturnValue(mockService);
    
    const status = {
      current_temp: 77,
      target_temp: 70,
      operation_mode: 'cool',
      fan_mode: 'Auto',
      is_on: PowerState.On, // Use Enum
      swing_mode: 'off',
      outdoor_temp: 86, // ~30°C
    };
    
    sensorAccessory.updateStatus(status);
    
    expect(accessory.getService).toHaveBeenCalledWith('Outdoor Temperature');
    expect(accessory.addService).not.toHaveBeenCalled();
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.CurrentTemperature,
      30
    );
  });

  it('should not create service when outdoor_temp is 0', () => {
    const status = {
      current_temp: 77,
      target_temp: 70,
      operation_mode: 'cool',
      fan_mode: 'Auto',
      is_on: PowerState.On, // Use Enum
      swing_mode: 'off',
      outdoor_temp: 0, // Invalid value
    };
    
    sensorAccessory.updateStatus(status);
    
    expect(accessory.getService).not.toHaveBeenCalled();
  });

  it('should not create service when outdoor_temp is NaN', () => {
    const status = {
      current_temp: 77,
      target_temp: 70,
      operation_mode: 'cool',
      fan_mode: 'Auto',
      is_on: PowerState.On, // Use Enum
      swing_mode: 'off',
      outdoor_temp: NaN,
    };
    
    sensorAccessory.updateStatus(status);
    
    expect(accessory.getService).not.toHaveBeenCalled();
  });

  it('should not create service when enableTemperature is false', () => {
    deviceConfig.enableTemperature = false;
    
    const status = {
      current_temp: 77,
      target_temp: 70,
      operation_mode: 'cool',
      fan_mode: 'Auto',
      is_on: PowerState.On, // Use Enum
      swing_mode: 'off',
      outdoor_temp: 86,
    };
    
    sensorAccessory.updateStatus(status);
    
    expect(accessory.getService).not.toHaveBeenCalled();
  });

  it('should remove service when removeService is called', () => {
    // Create a service first
    const status = {
      current_temp: 77,
      target_temp: 70,
      operation_mode: 'cool',
      fan_mode: 'Auto',
      is_on: PowerState.On, // Use Enum
      swing_mode: 'off',
      outdoor_temp: 86,
    };
    
    sensorAccessory.updateStatus(status);
    
    // Reset mocks to clearly see the next calls
    jest.clearAllMocks();
    
    sensorAccessory.removeService();
    
    expect(platform.log.info).toHaveBeenCalled();
    expect(accessory.removeService).toHaveBeenCalledWith(mockService);
  });

  it('should set default temperature when updateStatus is called with null', () => {
    sensorAccessory.updateStatus(null);
    expect(mockService.updateCharacteristic).not.toHaveBeenCalled();
  });

  it('should not throw when removeService is called and no service exists', () => {
    // Remove without ever adding
    expect(() => sensorAccessory.removeService()).not.toThrow();
  });

  it('should not create service when outdoor_temp is missing', () => {
    const status = {
      current_temp: 77,
      target_temp: 70,
      operation_mode: 'cool',
      fan_mode: 'Auto',
      is_on: PowerState.On, // Use Enum
      swing_mode: 'off',
      // outdoor_temp missing
    };
    sensorAccessory.updateStatus(status as any);
    expect(accessory.getService).not.toHaveBeenCalled();
    expect(accessory.addService).not.toHaveBeenCalled();
  });

  it('should not create service when outdoor_temp is a string', () => {
    const status = {
      current_temp: 77,
      target_temp: 70,
      operation_mode: 'cool',
      fan_mode: 'Auto',
      is_on: PowerState.On, // Use Enum
      swing_mode: 'off',
      outdoor_temp: "notanumber",
    };
    sensorAccessory.updateStatus(status as any);
    expect(accessory.getService).not.toHaveBeenCalled();
    expect(accessory.addService).not.toHaveBeenCalled();
  });

  it('handleCurrentTemperatureGet returns default when no service exists', () => {
    const cb = jest.fn();
    // Invoke private method
    (sensorAccessory as any).handleCurrentTemperatureGet(cb);
    expect(cb).toHaveBeenCalledWith(null, 20);
  });

  it('handleCurrentTemperatureGet returns service value when service exists', () => {
    // Create service by updating status
    const createStatus = {
      current_temp: 77,
      target_temp: 70,
      operation_mode: 'cool',
      fan_mode: 'Auto',
      is_on: PowerState.On, // Use Enum
      swing_mode: 'off',
      outdoor_temp: 86,
    } as any;
    sensorAccessory.updateStatus(createStatus);
    // Mock getCharacteristic to return custom value
    mockService.getCharacteristic.mockReturnValueOnce({ value: 25, on: jest.fn() });
    const cb = jest.fn();
    (sensorAccessory as any).handleCurrentTemperatureGet(cb);
    expect(cb).toHaveBeenCalledWith(null, 25);
  });

  it('updateStatus removes service when called with null after creation', () => {
    // First create the service
    const goodStatus = {
      current_temp: 70,
      target_temp: 65,
      operation_mode: 'heat',
      fan_mode: 'Low',
      is_on: PowerState.On, // Use Enum
      swing_mode: 'off',
      outdoor_temp: 68,
    } as any;
    sensorAccessory.updateStatus(goodStatus);
    jest.clearAllMocks();
    // Now call updateStatus with null to trigger removal
    sensorAccessory.updateStatus(null);
    expect(platform.log.debug).toHaveBeenCalledWith('[OutdoorTemperatureSensor] Removing service.');
    expect(accessory.removeService).toHaveBeenCalledWith(mockService);
  });

});
