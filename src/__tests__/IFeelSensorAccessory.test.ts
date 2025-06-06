import { vi, it, expect, describe, beforeEach } from 'vitest';
import { PlatformAccessory, Service } from 'homebridge';
import { TfiacPlatform } from '../platform.js';
import { IFeelSensorAccessory } from '../IFeelSensorAccessory.js';
import { TfiacDeviceConfig } from '../settings.js';
import { PowerState, OperationMode } from '../enums.js';

describe('IFeelSensorAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let deviceConfig: TfiacDeviceConfig;
  let sensorAccessory: IFeelSensorAccessory;
  let mockService: any;

  beforeEach(() => {
    // Mock service
    mockService = {
      setCharacteristic: vi.fn().mockReturnThis(),
      getCharacteristic: vi.fn().mockReturnValue({
        on: vi.fn().mockReturnThis(),
        onGet: vi.fn().mockReturnThis(),
        onSet: vi.fn().mockReturnThis(),
        value: false,
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
        Switch: vi.fn(),
      },
      Characteristic: {
        Name: 'Name',
        ConfiguredName: 'ConfiguredName',
        On: 'On',
      },
      api: {
        hap: {
          Characteristic: {
            Perms: {
              PAIRED_READ: 'PAIRED_READ',
              NOTIFY: 'NOTIFY'
            }
          }
        }
      }
    } as unknown as TfiacPlatform;

    // Mock device config
    deviceConfig = {
      name: 'Test Device',
      ip: '192.168.1.100',
      port: 8080,
      updateInterval: 30,
      enableIFeelSensor: true
    };

    // Mock accessory
    accessory = {
      context: { deviceConfig },
      getServiceById: vi.fn().mockReturnValue(null),
      addService: vi.fn().mockReturnValue(mockService),
      removeService: vi.fn(),
    } as unknown as PlatformAccessory;

    // Create the accessory
    sensorAccessory = new IFeelSensorAccessory(platform, accessory, deviceConfig);
  });

  it('should create an instance', () => {
    expect(sensorAccessory).toBeDefined();
  });

  it('should add a new service if none exists', () => {
    expect(accessory.getServiceById).toHaveBeenCalledWith(
      platform.Service.Switch,
      'ifeel_sensor'
    );
    expect(accessory.addService).toHaveBeenCalledWith(
      platform.Service.Switch,
      'iFeel',
      'ifeel_sensor'
    );
    expect(mockService.setCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.Name,
      'iFeel'
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
        onGet: vi.fn().mockReturnThis(),
        onSet: vi.fn().mockReturnThis(),
        value: false,
      }),
      updateCharacteristic: vi.fn(),
    };
    
    (accessory.getServiceById as ReturnType<typeof vi.fn>).mockReturnValue(existingService);
    
    // Create new instance with existing service
    const newAccessory = new IFeelSensorAccessory(platform, accessory, deviceConfig);
    
    expect(accessory.getServiceById).toHaveBeenCalledWith(
      platform.Service.Switch,
      'ifeel_sensor'
    );
    expect(accessory.addService).not.toHaveBeenCalled();
    expect(existingService.setCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.Name,
      'iFeel'
    );
  });

  it('should update state to ON when operation_mode is selfFeel', () => {
    const status = {
      current_temp: 77,
      target_temp: 70,
      operation_mode: OperationMode.SelfFeel,
      fan_mode: 'Auto',
      is_on: PowerState.On,
      swing_mode: 'off',
    };
    
    sensorAccessory.updateStatus(status);
    
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.On,
      true
    );
  });

  it('should update state to ON when operation_mode is selfFeel even if power is OFF', () => {
    const status = {
      current_temp: 77,
      target_temp: 70,
      operation_mode: OperationMode.SelfFeel,
      fan_mode: 'Auto',
      is_on: PowerState.Off, // Note: Power is OFF
      swing_mode: 'off',
    };
    
    sensorAccessory.updateStatus(status);
    
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.On,
      true // Should still be ON because operation_mode is selfFeel
    );
    expect(platform.log.debug).toHaveBeenCalledWith(
      expect.stringContaining('ON (mode: selfFeel, power: off)')
    );
  });

  it('should update state to OFF when operation_mode is not selfFeel', () => {
    const status = {
      current_temp: 77,
      target_temp: 70,
      operation_mode: OperationMode.Cool,
      fan_mode: 'Auto',
      is_on: PowerState.On,
      swing_mode: 'off',
    };
    
    sensorAccessory.updateStatus(status);
    
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.On,
      false
    );
  });

  it('should set default state (OFF) when updateStatus is called with null', () => {
    sensorAccessory.updateStatus(null);
    
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.On,
      false
    );
  });

  it('should not initialize service when enableIFeelSensor is false', () => {
    vi.clearAllMocks();
    
    const configWithDisabledSensor = {
      ...deviceConfig,
      enableIFeelSensor: false
    };
    
    accessory.context.deviceConfig = configWithDisabledSensor;
    
    const disabledSensorAccessory = new IFeelSensorAccessory(platform, accessory, configWithDisabledSensor);
    
    expect(accessory.getServiceById).not.toHaveBeenCalled();
    expect(accessory.addService).not.toHaveBeenCalled();
  });

  it('should not update status when enableIFeelSensor is false', () => {
    vi.clearAllMocks();
    
    const configWithDisabledSensor = {
      ...deviceConfig,
      enableIFeelSensor: false
    };
    
    accessory.context.deviceConfig = configWithDisabledSensor;
    
    const disabledSensorAccessory = new IFeelSensorAccessory(platform, accessory, configWithDisabledSensor);
    
    const status = {
      current_temp: 77,
      target_temp: 70,
      operation_mode: OperationMode.SelfFeel,
      fan_mode: 'Auto',
      is_on: PowerState.On,
      swing_mode: 'off',
    };
    
    disabledSensorAccessory.updateStatus(status);
    
    expect(mockService.updateCharacteristic).not.toHaveBeenCalled();
  });

  it('should return current value in handleOnGet', async () => {
    // By default DeviceState has operationMode !== selfFeel, so expect false
    const result = await (sensorAccessory as any).handleOnGet();
    
    expect(result).toBe(false);
    expect(platform.log.debug).toHaveBeenCalledWith('Triggered GET iFeelSensor.On');
  });

  it('should return false in handleOnGet when no value is available', async () => {
    mockService.getCharacteristic.mockReturnValueOnce({ value: undefined });
    
    const result = await (sensorAccessory as any).handleOnGet();
    
    expect(result).toBe(false);
  });

  it('should remove the service when removeService is called', () => {
    sensorAccessory.removeService();
    
    expect(platform.log.info).toHaveBeenCalledWith('[iFeelSensor] Removing service.');
    expect(accessory.removeService).toHaveBeenCalledWith(mockService);
  });
});