import { vi, it, expect, describe, beforeEach } from 'vitest';
import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from '../platform.js';
import { OutdoorTemperatureSensorAccessory } from '../OutdoorTemperatureSensorAccessory.js';
import { TfiacDeviceConfig } from '../settings.js';
import { PowerState } from '../enums.js';
import { AirConditionerStatus } from '../AirConditionerAPI.js';
import { 
  setupTestPlatform, 
  createMockPlatformAccessory, 
  createMockService 
} from './testUtils.js';

// Helper function to create valid AirConditionerStatus objects for tests
function createTestStatus(outdoor_temp: number): AirConditionerStatus {
  return {
    outdoor_temp,
    is_on: PowerState.On,
    operation_mode: 'auto',
    target_temp: 72,
    current_temp: 75,
    fan_mode: 'Auto',
    swing_mode: 'Off'
  };
}

describe('OutdoorTemperatureSensorAccessory - Additional Coverage', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let deviceConfig: TfiacDeviceConfig;
  let sensorAccessory: OutdoorTemperatureSensorAccessory;
  let mockService: any;

  beforeEach(() => {
    // Setup test platform
    platform = setupTestPlatform();
    
    // Add spy methods to the platform.log
    Object.defineProperties(platform.log, {
      'debug': { value: vi.fn() },
      'info': { value: vi.fn() },
      'warn': { value: vi.fn() },
      'error': { value: vi.fn() },
      'log': { value: vi.fn() },
      'success': { value: vi.fn() }
    });
    
    // Create mockService
    mockService = createMockService();

    // Mock device config with extended properties
    deviceConfig = {
      name: 'Test Device',
      ip: '192.168.1.100',
      port: 8080,
      updateInterval: 30,
      enableTemperature: true,
      enableOutdoorTempSensor: true,
      temperatureCorrection: 2, // Add temperatureCorrection for testing
    };

    // Create accessory
    accessory = createMockPlatformAccessory('Test Device', 'test-uuid', deviceConfig);
    
    // Mock necessary methods
    accessory.getServiceById = vi.fn().mockReturnValue(null);
    accessory.addService = vi.fn().mockReturnValue(mockService);
    accessory.removeService = vi.fn();

    // Create the accessory
    sensorAccessory = new OutdoorTemperatureSensorAccessory(platform, accessory, deviceConfig);
  });

  // Test for the scenario when platform.Service is not available
  it('should handle missing platform.Service', () => {
    // Create a platform without Service
    const limitedPlatform = { ...platform, Service: undefined } as unknown as TfiacPlatform;
    
    // Create accessory with limited platform
    const limitedAccessory = new OutdoorTemperatureSensorAccessory(
      limitedPlatform,
      accessory,
      deviceConfig
    );
    
    // Call updateStatus with valid data
    const status = createTestStatus(86);
    
    limitedAccessory.updateStatus(status);
    
    // Should not try to create service
    expect(accessory.getServiceById).not.toHaveBeenCalled();
    expect(accessory.addService).not.toHaveBeenCalled();
  });

  // Test for error handling in ensureService
  it('should handle errors in ensureService', () => {
    // Mock setCharacteristic to throw an error
    mockService.setCharacteristic = vi.fn().mockImplementation(() => {
      throw new Error('Test error in setCharacteristic');
    });
    
    // Call updateStatus which will call ensureService
    const status = createTestStatus(86);
    
    sensorAccessory.updateStatus(status);
    
    // Should log the error but continue
    expect(platform.log.debug).toHaveBeenCalledWith(
      'Error configuring outdoor temperature sensor:',
      expect.any(Error)
    );
    
    // Service should still be created
    expect(accessory.getServiceById).toHaveBeenCalled();
    expect(accessory.addService).toHaveBeenCalled();
  });

  // Test for when ConfiguredName characteristic is available
  it('should set ConfiguredName if available', () => {
    // Add ConfiguredName to platform.Characteristic
    platform.Characteristic.ConfiguredName = 'ConfiguredName-UUID' as any;
    
    // Call updateStatus with valid data
    const status = createTestStatus(86);
    
    sensorAccessory.updateStatus(status);
    
    // Should set ConfiguredName
    expect(mockService.setCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.ConfiguredName,
      'Outdoor Temperature'
    );
  });

  // Test for temperatureCorrection being applied
  it('should apply temperature correction', () => {
    const status = createTestStatus(80); // ~26.67°C without correction
    
    sensorAccessory.updateStatus(status);
    
    // Should apply the 2 degree correction (26.67 + 2 = 28.67°C)
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.CurrentTemperature,
      expect.closeTo(28.67, 0.1) // Allow for small floating point differences
    );
  });

  // Test when temperatureCorrection is not a number
  it('should handle non-numeric temperatureCorrection', () => {
    // Set temperatureCorrection to a non-number
    deviceConfig.temperatureCorrection = 'invalid' as any;
    
    const status = createTestStatus(80); // ~26.67°C
    
    sensorAccessory.updateStatus(status);
    
    // Should default to 0 correction
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.CurrentTemperature,
      expect.closeTo(26.67, 0.1)
    );
  });

  // Test for when service exists but updateCharacteristic is not a function
  it('should handle service without updateCharacteristic method', () => {
    // Create service without updateCharacteristic
    const invalidService = { ...mockService };
    invalidService.updateCharacteristic = undefined;
    
    // Override accessory.getServiceById to return our invalid service
    accessory.getServiceById = vi.fn().mockReturnValue(invalidService);
    
    const status = createTestStatus(86);
    
    // Should not throw an error
    expect(() => sensorAccessory.updateStatus(status)).not.toThrow();
  });

  // Test handling of invalid outdoor temperature types
  it('should handle outdoor_temp as an empty string', () => {
    const status = {
      outdoor_temp: '',
      is_on: PowerState.On,
      operation_mode: 'auto',
      target_temp: 72,
      current_temp: 75,
      fan_mode: 'Auto',
      swing_mode: 'Off'
    } as any as AirConditionerStatus;
    
    sensorAccessory.updateStatus(status);
    
    // Should not create service
    expect(accessory.getServiceById).not.toHaveBeenCalled();
  });

  // Test error handling in removeService
  it('should handle errors in removeService', () => {
    // First create a service
    const status = createTestStatus(86);
    
    sensorAccessory.updateStatus(status);
    
    // Mock removeService to throw
    accessory.removeService = vi.fn().mockImplementation(() => {
      throw new Error('Error removing service');
    });
    
    // Call removeService and expect it not to throw (it should catch internally)
    expect(() => sensorAccessory.removeService()).not.toThrow();
    
    // Should log error
    expect(platform.log.info).toHaveBeenCalledWith(
      '[OutdoorTemperatureSensor] Removing service.'
    );
  });

  // Test support for both enableOutdoorTempSensor and enableTemperature flags
  it('should respect both enableOutdoorTempSensor and enableTemperature flags', () => {
    // Set enableOutdoorTempSensor to false but enableTemperature to true
    deviceConfig.enableOutdoorTempSensor = false;
    deviceConfig.enableTemperature = true;
    
    const status = createTestStatus(86);
    
    sensorAccessory.updateStatus(status);
    
    // Should not create service
    expect(accessory.getServiceById).not.toHaveBeenCalled();
    expect(accessory.addService).not.toHaveBeenCalled();
    
    // Set enableOutdoorTempSensor to true but enableTemperature to false
    deviceConfig.enableOutdoorTempSensor = true;
    deviceConfig.enableTemperature = false;
    
    sensorAccessory.updateStatus(status);
    
    // Should still not create service
    expect(accessory.getServiceById).not.toHaveBeenCalled();
    expect(accessory.addService).not.toHaveBeenCalled();
  });

  // Test service creation in ensureService for mock objects
  it('should create a mock service when accessory.addService is not a function', () => {
    // Create accessory without addService
    // Create a proper mock that satisfies TypeScript but has the methods we need to test
    const limitedAccessory = {
      ...accessory,
      addService: undefined,
      getServiceById: vi.fn().mockReturnValue(null)
    } as unknown as PlatformAccessory;
    
    const limitedSensorAccessory = new OutdoorTemperatureSensorAccessory(
      platform,
      limitedAccessory,
      deviceConfig
    );
    
    const status = createTestStatus(86);
    
    // Should not throw
    expect(() => limitedSensorAccessory.updateStatus(status)).not.toThrow();
  });
});
