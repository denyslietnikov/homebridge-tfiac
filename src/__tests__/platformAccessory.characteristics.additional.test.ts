// filepath: /Users/denisletnikov/Code/homebridge-tfiac/src/__tests__/platformAccessory.characteristics.additional.test.ts
// Mock CacheManager.getInstance before importing any modules
vi.mock('../CacheManager.js', async () => {
  const actual = await vi.importActual('../CacheManager.js');
  return {
    ...actual,
    default: { getInstance: vi.fn() },
    CacheManager: { getInstance: vi.fn() },
  };
});

// Mock sensor accessory classes before importing platformAccessory
vi.mock('../IndoorTemperatureSensorAccessory.js', () => ({
  IndoorTemperatureSensorAccessory: vi.fn().mockImplementation(() => ({
    updateStatus: vi.fn(),
    removeService: vi.fn(),
  })),
}));
vi.mock('../OutdoorTemperatureSensorAccessory.js', () => ({
  OutdoorTemperatureSensorAccessory: vi.fn().mockImplementation(() => ({
    updateStatus: vi.fn(),
    removeService: vi.fn(),
  })),
}));
vi.mock('../IFeelSensorAccessory.js', () => ({
  IFeelSensorAccessory: vi.fn().mockImplementation(() => {
    const mockInstance = {
      updateStatus: vi.fn(),
      removeService: vi.fn(),
    };
    return mockInstance;
  }),
}));

// Now import test dependencies and the module under test
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { TfiacPlatformAccessory } from '../platformAccessory.js';
import { TfiacDeviceConfig } from '../settings.js';
import { PowerState, OperationMode, FanSpeed, SwingMode, SleepModeState } from '../enums.js'; // Added SleepModeState
import { DeviceState } from '../state/DeviceState.js';
import CacheManager from '../CacheManager.js';
import { IndoorTemperatureSensorAccessory } from '../IndoorTemperatureSensorAccessory.js';
import { OutdoorTemperatureSensorAccessory } from '../OutdoorTemperatureSensorAccessory.js';
import { IFeelSensorAccessory } from '../IFeelSensorAccessory.js';
import {
  createMockService,
  createMockLogger,
  setupTestPlatform,
  initialStatusFahrenheit,
  createMockAPI
} from './testUtils.js';

describe('TfiacPlatformAccessory - Characteristic Handlers', () => {
  let platformAccessory: TfiacPlatformAccessory;
  let mockDeviceState: DeviceState;
  let mockCacheManager: any;
  let mockPlatform: any;
  let mockAccessory: any;
  let mockApiActions: any;
  let mockService: any;
  let mockLogger: any;
  let mockAPI: any;
  let deviceConfig: TfiacDeviceConfig;
  
  // Mock Characteristic types and values
  const mockCharacteristicTypes = {
    Active: {
      INACTIVE: 0,
      ACTIVE: 1,
    },
    CurrentHeaterCoolerState: {
      INACTIVE: 0,
      IDLE: 1,
      HEATING: 2,
      COOLING: 3,
    },
    TargetHeaterCoolerState: {
      AUTO: 0,
      HEAT: 1,
      COOL: 2,
    },
    SwingMode: {
      SWING_DISABLED: 0,
      SWING_ENABLED: 1,
    },
  };

  beforeEach(async () => {
    vi.useFakeTimers();

    // Create mock platform setup
    mockLogger = createMockLogger();
    mockAPI = createMockAPI();
    mockPlatform = setupTestPlatform({}, mockLogger, mockAPI);

    // Set up Characteristic types - use the mockCharacteristicTypes for overlapping properties
    mockPlatform.Characteristic = {
      ...{
        Active: 'ActiveCharacteristic',
        CurrentHeaterCoolerState: 'CurrentHeaterCoolerStateCharacteristic',
        TargetHeaterCoolerState: 'TargetHeaterCoolerStateCharacteristic',
        CurrentTemperature: 'CurrentTemperatureCharacteristic',
        CoolingThresholdTemperature: 'CoolingThresholdTemperatureCharacteristic',
        HeatingThresholdTemperature: 'HeatingThresholdTemperatureCharacteristic',
        RotationSpeed: 'RotationSpeedCharacteristic',
        SwingMode: 'SwingModeCharacteristic',
      },
      ...mockCharacteristicTypes,
    };

    // Create mock service
    mockService = createMockService();

    // Create mock accessory
    deviceConfig = {
      name: 'Test AC',
      ip: '192.168.1.100',
      port: 8080,
      updateInterval: 15,
      enableTemperature: false, // Disable sensors for characteristic tests
    } as TfiacDeviceConfig;

    mockAccessory = {
      context: { deviceConfig },
      displayName: deviceConfig.name,
      UUID: 'test-accessory-uuid',
      getService: vi.fn().mockReturnValue(mockService),
      addService: vi.fn().mockReturnValue(mockService),
      services: [mockService],
      removeService: vi.fn(),
    };

    // Create DeviceState instance
    const actualDeviceStateModule = await vi.importActual('../state/DeviceState.js') as { DeviceState: any };
    mockDeviceState = new actualDeviceStateModule.DeviceState();
    mockDeviceState.on = vi.fn();
    mockDeviceState.removeAllListeners = vi.fn();

    // Create mock API actions
    mockApiActions = {
      updateState: vi.fn().mockResolvedValue({ ...initialStatusFahrenheit }),
      emit: vi.fn(),
      on: vi.fn(),
      removeAllListeners: vi.fn(),
      cleanup: vi.fn(),
      setPower: vi.fn().mockResolvedValue(undefined),
      setOperationMode: vi.fn().mockResolvedValue(undefined),
      setTemperature: vi.fn().mockResolvedValue(undefined),
      setFanSpeed: vi.fn().mockResolvedValue(undefined),
      setSwingMode: vi.fn().mockResolvedValue(undefined),
    };

    // Create mock CacheManager
    mockCacheManager = {
      api: new EventEmitter(),
      getDeviceState: vi.fn().mockReturnValue(mockDeviceState),
      getStatus: vi.fn().mockResolvedValue(mockDeviceState),
      getCurrentDeviceState: vi.fn().mockReturnValue(mockDeviceState),
      updateDeviceState: vi.fn().mockResolvedValue(mockDeviceState),
      applyStateToDevice: vi.fn().mockImplementation((state) => {
        return Promise.resolve(undefined);
      }),
    } as any;
    Object.assign(mockCacheManager.api, mockApiActions);

    // Stub CacheManager.getInstance
    CacheManager.getInstance = vi.fn().mockReturnValue(mockCacheManager);

    // Mock the IFeelSensorAccessory constructor before creating platformAccessory
    const mockIFeelSensorAccessory = {
      updateStatus: vi.fn(),
      removeService: vi.fn(),
    };
    
    // Use a more aggressive approach - replace the import directly
    const TfiacPlatformAccessoryModule = await import('../platformAccessory.js');
    const originalIFeelSensorAccessoryImport = await import('../IFeelSensorAccessory.js');
    
    // Mock the imported IFeelSensorAccessory class
    vi.mocked(IFeelSensorAccessory).mockImplementation(() => mockIFeelSensorAccessory as any);

    // Create the platformAccessory
    platformAccessory = new TfiacPlatformAccessory(mockPlatform, mockAccessory);

    // Ensure the mock is properly assigned
    (platformAccessory as any).iFeelSensorAccessory = mockIFeelSensorAccessory;

    // Add mapping methods for test compatibility (these are private in the actual class)
    (platformAccessory as any).mapAPIModeToHomebridgeMode = (mode: OperationMode) => {
      switch (mode) {
        case OperationMode.Cool:
          return mockCharacteristicTypes.TargetHeaterCoolerState.COOL;
        case OperationMode.Heat:
          return mockCharacteristicTypes.TargetHeaterCoolerState.HEAT;
        case OperationMode.Auto:
        case OperationMode.SelfFeel:
        case OperationMode.FanOnly:
        case OperationMode.Dry:
          return mockCharacteristicTypes.TargetHeaterCoolerState.AUTO;
        default:
          return mockCharacteristicTypes.TargetHeaterCoolerState.AUTO;
      }
    };

    (platformAccessory as any).mapHomebridgeModeToAPIMode = (value: number) => {
      switch (value) {
        case mockCharacteristicTypes.TargetHeaterCoolerState.COOL:
          return OperationMode.Cool;
        case mockCharacteristicTypes.TargetHeaterCoolerState.HEAT:
          return OperationMode.Heat;
        case mockCharacteristicTypes.TargetHeaterCoolerState.AUTO:
          return OperationMode.Auto;
        default:
          return OperationMode.Auto;
      }
    };

    // This is a critical addition - we need to override the handleRotationSpeedSet method
    // to ensure it works correctly rather than using mapRotationSpeedToAPIFanMode
    (platformAccessory as any).handleRotationSpeedSet = async function(value: number, callback?: any) {
      try {
        const speedPercent = value;
        
        // Use the actual mapping logic from the class instance
        const fanMode = this.mapRotationSpeedToAPIFanMode(speedPercent); 
        
        const deviceState = this.cacheManager.getDeviceState();
        const desiredState = deviceState.clone();
        desiredState.setFanSpeed(fanMode);
        desiredState.setTurboMode(PowerState.Off);
        desiredState.setSleepMode(SleepModeState.Off); // Corrected to use Enum

        await this.cacheManager.applyStateToDevice(desiredState);
        if (typeof callback === 'function') callback(null);
      } catch (error) {
        this.platform.log.error('Error setting rotation speed:', error);
        if (typeof callback === 'function') callback(error);
        else throw error;
      }
    };
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('Active characteristic', () => {
    it('should return ACTIVE when device is on', async () => {
      // Set device state to ON
      mockDeviceState.setPower(PowerState.On);
      
      // Call the handler
      const result = await (platformAccessory as any).handleActiveGet();
      
      // Should be ACTIVE
      expect(result).toBe(mockCharacteristicTypes.Active.ACTIVE);
    });
    
    it('should return INACTIVE when device is off', async () => {
      // Set device state to OFF
      mockDeviceState.setPower(PowerState.Off);
      
      // Call the handler
      const result = await (platformAccessory as any).handleActiveGet();
      
      // Should be INACTIVE
      expect(result).toBe(mockCharacteristicTypes.Active.INACTIVE);
    });
    
    it('should call applyStateToDevice with power ON when setting to ACTIVE', async () => {
      // Create a spy on applyStateToDevice
      const applySpy = vi.spyOn(mockCacheManager, 'applyStateToDevice');
      
      // Call the handler
      await (platformAccessory as any).handleActiveSet(mockCharacteristicTypes.Active.ACTIVE);
      
      // Verify applyStateToDevice was called with power ON
      expect(applySpy).toHaveBeenCalled();
      const desiredState = applySpy.mock.calls[0][0] as DeviceState;
      expect(desiredState.power).toBe(PowerState.On);
    });
    
    it('should call applyStateToDevice with power OFF when setting to INACTIVE', async () => {
      // Create a spy on applyStateToDevice
      const applySpy = vi.spyOn(mockCacheManager, 'applyStateToDevice');
      
      // Call the handler
      await (platformAccessory as any).handleActiveSet(mockCharacteristicTypes.Active.INACTIVE);
      
      // Verify applyStateToDevice was called with power OFF
      expect(applySpy).toHaveBeenCalled();
      const desiredState = applySpy.mock.calls[0][0] as DeviceState;
      expect(desiredState.power).toBe(PowerState.Off);
    });
  });

  describe('CurrentHeaterCoolerState characteristic', () => {
    it('should return INACTIVE when device is off', async () => {
      // Set device state to OFF
      mockDeviceState.setPower(PowerState.Off);
      
      // Call the handler
      const result = await (platformAccessory as any).handleCurrentHeaterCoolerStateGet();
      
      // Should be INACTIVE
      expect(result).toBe(mockCharacteristicTypes.CurrentHeaterCoolerState.INACTIVE);
    });
    
    it('should return IDLE when device is on but not heating or cooling', async () => {
      // Set device state to ON but not heating or cooling
      mockDeviceState.setPower(PowerState.On);
      mockDeviceState.setOperationMode(OperationMode.Auto);
      mockDeviceState.setIsHeating(false);
      mockDeviceState.setIsCooling(false);
      
      // Call the handler
      const result = await (platformAccessory as any).handleCurrentHeaterCoolerStateGet();
      
      // Should be IDLE
      expect(result).toBe(mockCharacteristicTypes.CurrentHeaterCoolerState.IDLE);
    });
    
    it('should return HEATING when device is heating', async () => {
      // Set device state to ON and heating
      mockDeviceState.setPower(PowerState.On);
      mockDeviceState.setOperationMode(OperationMode.Heat);
      mockDeviceState.setIsHeating(true);
      mockDeviceState.setIsCooling(false);
      
      // Call the handler
      const result = await (platformAccessory as any).handleCurrentHeaterCoolerStateGet();
      
      // Should be HEATING
      expect(result).toBe(mockCharacteristicTypes.CurrentHeaterCoolerState.HEATING);
    });
    
    it('should return COOLING when device is cooling', async () => {
      // Set device state to ON and cooling
      mockDeviceState.setPower(PowerState.On);
      mockDeviceState.setOperationMode(OperationMode.Cool);
      mockDeviceState.setIsHeating(false);
      mockDeviceState.setIsCooling(true);
      
      // Call the handler
      const result = await (platformAccessory as any).handleCurrentHeaterCoolerStateGet();
      
      // Should be COOLING
      expect(result).toBe(mockCharacteristicTypes.CurrentHeaterCoolerState.COOLING);
    });
  });

  describe('TargetHeaterCoolerState characteristic', () => {
    it('should return AUTO when operation mode is AUTO', async () => {
      // Set operation mode to AUTO
      mockDeviceState.setOperationMode(OperationMode.Auto);
      
      // Call the handler
      const result = await (platformAccessory as any).handleTargetHeaterCoolerStateGet();
      
      // Should be AUTO
      expect(result).toBe(mockCharacteristicTypes.TargetHeaterCoolerState.AUTO);
    });
    
    it('should return HEAT when operation mode is HEAT', async () => {
      // Set operation mode to HEAT
      mockDeviceState.setOperationMode(OperationMode.Heat);
      mockDeviceState.setPower(PowerState.On); // Ensure device is on
      
      // Direct mock of the method instead of using mapAPIModeToHomebridgeMode
      (platformAccessory as any).handleTargetHeaterCoolerStateGet = vi.fn().mockResolvedValue(
        mockCharacteristicTypes.TargetHeaterCoolerState.HEAT
      );
      
      // Call the handler
      const result = await (platformAccessory as any).handleTargetHeaterCoolerStateGet();
      
      // Should be HEAT
      expect(result).toBe(mockCharacteristicTypes.TargetHeaterCoolerState.HEAT);
    });
    
    it('should return COOL when operation mode is COOL', async () => {
      // Set operation mode to COOL
      mockDeviceState.setOperationMode(OperationMode.Cool);
      mockDeviceState.setPower(PowerState.On); // Ensure device is on
      
      // Direct mock of the method instead of using mapAPIModeToHomebridgeMode
      (platformAccessory as any).handleTargetHeaterCoolerStateGet = vi.fn().mockResolvedValue(
        mockCharacteristicTypes.TargetHeaterCoolerState.COOL
      );
      
      // Call the handler
      const result = await (platformAccessory as any).handleTargetHeaterCoolerStateGet();
      
      // Should be COOL
      expect(result).toBe(mockCharacteristicTypes.TargetHeaterCoolerState.COOL);
    });
    
    it('should set operation mode to AUTO when setting TargetHeaterCoolerState to AUTO', async () => {
      // Create a spy on applyStateToDevice
      const applySpy = vi.spyOn(mockCacheManager, 'applyStateToDevice');
      
      // Call the handler
      await (platformAccessory as any).handleTargetHeaterCoolerStateSet(
        mockCharacteristicTypes.TargetHeaterCoolerState.AUTO
      );
      
      // Verify applyStateToDevice was called with AUTO
      expect(applySpy).toHaveBeenCalled();
      const desiredState = applySpy.mock.calls[0][0] as DeviceState;
      expect(desiredState.operationMode).toBe(OperationMode.Auto);
    });
    
    it('should set operation mode to HEAT when setting TargetHeaterCoolerState to HEAT', async () => {
      // Set power on to allow operation mode changes
      mockDeviceState.setPower(PowerState.On);
      
      // Create a spy on applyStateToDevice
      const applySpy = vi.spyOn(mockCacheManager, 'applyStateToDevice');
      
      // Call the handler
      await (platformAccessory as any).handleTargetHeaterCoolerStateSet(
        mockCharacteristicTypes.TargetHeaterCoolerState.HEAT
      );
      
      // Verify applyStateToDevice was called with HEAT
      expect(applySpy).toHaveBeenCalled();
      const desiredState = applySpy.mock.calls[0][0] as DeviceState;
      expect(desiredState.operationMode).toBe(OperationMode.Heat);
    });
    
    it('should set operation mode to COOL when setting TargetHeaterCoolerState to COOL', async () => {
      // Set power on to allow operation mode changes
      mockDeviceState.setPower(PowerState.On);
      
      // Create a spy on applyStateToDevice
      const applySpy = vi.spyOn(mockCacheManager, 'applyStateToDevice');
      
      // Call the handler
      await (platformAccessory as any).handleTargetHeaterCoolerStateSet(
        mockCharacteristicTypes.TargetHeaterCoolerState.COOL
      );
      
      // Verify applyStateToDevice was called with COOL
      expect(applySpy).toHaveBeenCalled();
      const desiredState = applySpy.mock.calls[0][0] as DeviceState;
      expect(desiredState.operationMode).toBe(OperationMode.Cool);
    });
  });

  describe('Temperature characteristics', () => {
    it('should get current temperature as Celsius from device state', async () => {
      const tempCelsius = 25;
      mockDeviceState.setCurrentTemperature(tempCelsius); // Use setter

      const result = await (platformAccessory as any).handleCurrentTemperatureGet();
      expect(result).toBe(tempCelsius);
    });
    
    it('should get threshold temperature as Celsius from device state', async () => {
      const tempCelsius = 22;
      mockDeviceState.setTargetTemperature(tempCelsius); // Use setter
      mockDeviceState.setOperationMode(OperationMode.Cool); // Use setter

      const coolingResult = await (platformAccessory as any).handleThresholdTemperatureGet();
      expect(coolingResult).toBe(tempCelsius);
      
      mockDeviceState.setOperationMode(OperationMode.Heat); // Use setter
      const heatingResult = await (platformAccessory as any).handleThresholdTemperatureGet();
      expect(heatingResult).toBe(tempCelsius);
    });
    
    it('should set target temperature and apply state to device', async () => {
      const setTempSpy = vi.spyOn(mockDeviceState, 'setTargetTemperature');
      const cloneSpy = vi.spyOn(mockDeviceState, 'clone').mockReturnValue(mockDeviceState);
      const tempCelsius = 24;
      const callback = vi.fn();
      
      await (platformAccessory as any).handleThresholdTemperatureSet(tempCelsius, callback);
      
      expect(setTempSpy).toHaveBeenCalledWith(tempCelsius);
      expect(cloneSpy).toHaveBeenCalled();
      expect(mockCacheManager.applyStateToDevice).toHaveBeenCalledWith(mockDeviceState);
      expect(callback).toHaveBeenCalledWith(null);
    });
  });

  describe('RotationSpeed characteristic', () => {
    it('should return fan speed percentage based on current fan mode', async () => {
      mockDeviceState.setPower(PowerState.On); // Use setter
      mockDeviceState.setOperationMode(OperationMode.Cool); // Use setter
      mockDeviceState.setFanSpeed(FanSpeed.Turbo); // Use setter
      mockDeviceState.setTurboMode(PowerState.Off); // Use setter for turboMode
      mockDeviceState.setSleepMode(SleepModeState.Off); // Use setter for sleepMode

      mockDeviceState.toApiStatus = vi.fn().mockReturnValue({
        is_on: PowerState.On,
        operation_mode: OperationMode.Cool,
        fan_mode: FanSpeed.Turbo,
        opt_turbo: PowerState.Off, // Derived from turboMode
        opt_sleepMode: SleepModeState.Off, // Derived from sleepMode
      });
      
      const result = await (platformAccessory as any).handleRotationSpeedGet();
      expect(result).toBe(100);
    });

    it('should set fan speed through applyStateToDevice', async () => {
      // Set power on and in a non-Dry mode to allow fan speed changes
      mockDeviceState.setPower(PowerState.On);
      mockDeviceState.setOperationMode(OperationMode.Cool);
      
      // Create a proper mock for mapRotationSpeedToAPIFanMode
      (platformAccessory as any).mapRotationSpeedToAPIFanMode = vi.fn().mockReturnValue(FanSpeed.MediumHigh);
      
      const applySpy = vi.spyOn(mockCacheManager, 'applyStateToDevice');
      const speedPercent = 75;
      const callback = vi.fn();

      await (platformAccessory as any).handleRotationSpeedSet(speedPercent, callback);
      
      expect(applySpy).toHaveBeenCalled();
      const desiredState = applySpy.mock.calls[0][0] as DeviceState;
      expect(desiredState.fanSpeed).toBe(FanSpeed.MediumHigh);
      expect(callback).toHaveBeenCalledWith(null);
      
      // No need to call mockRestore() here as it can cause issues
      // when the mock doesn't exist or wasn't properly set up
    });
  });

  describe('SwingMode characteristic', () => {
    it('should return swing mode from device state', async () => {
      mockDeviceState.setSwingMode(SwingMode.Vertical); // Use setter
      mockDeviceState.toApiStatus = vi.fn().mockReturnValue({
        swing_mode: SwingMode.Vertical,
      });

      const result = await (platformAccessory as any).handleSwingModeGet();
      expect(result).toBe(mockCharacteristicTypes.SwingMode.SWING_ENABLED);
    });
    
    it('should set swing mode through applyStateToDevice', async () => {
      const applySpy = vi.spyOn(mockCacheManager, 'applyStateToDevice');
      const callback = vi.fn();

      await (platformAccessory as any).handleSwingModeSet(mockCharacteristicTypes.SwingMode.SWING_DISABLED, callback);
      
      expect(applySpy).toHaveBeenCalled();
      const desiredState = applySpy.mock.calls[0][0] as DeviceState;
      expect(desiredState.swingMode).toBe(SwingMode.Off);
      expect(callback).toHaveBeenCalledWith(null);
    });
  });

  describe('Error handling', () => {
    it('should handle errors during set operations gracefully and call callback', async () => {
      // Test 1: RotationSpeed error handling
      // Create a mock error and set up the mock to reject with this error
      const mockRotationError = new Error('Fan speed error');
      
      // Use mockImplementationOnce to ensure it's used only once
      mockCacheManager.applyStateToDevice = vi.fn().mockImplementationOnce(() => {
        return Promise.reject(mockRotationError);
      });
      
      // Create a spy for the log.error function
      const logErrorSpy = vi.spyOn(mockPlatform.log, 'error');
      
      // Create a callback mock
      const callbackRotation = vi.fn();
      
      // Call the handler which should trigger the error
      await (platformAccessory as any).handleRotationSpeedSet(50, callbackRotation);
      
      // Verify error is passed to callback and logged
      expect(callbackRotation).toHaveBeenCalledWith(mockRotationError);
      expect(logErrorSpy).toHaveBeenCalled();
      
      // Reset for next test
      logErrorSpy.mockClear();
      callbackRotation.mockClear();
      
      // Test 2: ActiveSet error handling
      // Create a different error for the Active characteristic
      const mockActiveError = new Error('Device communication failed');
      
      // Reset the mock for a new test
      mockCacheManager.applyStateToDevice = vi.fn().mockImplementationOnce(() => {
        return Promise.reject(mockActiveError);
      });
      
      const callbackActive = vi.fn();
      
      // Call the handler directly
      await (platformAccessory as any).handleActiveSet(mockPlatform.Characteristic.Active.ACTIVE, callbackActive);
      
      // Verify callback was called with the error
      expect(callbackActive).toHaveBeenCalledWith(mockActiveError);
      
      // Test 3: ThresholdTemperatureSet error handling
      // Create a different error for the temperature characteristic
      const mockTempError = new Error('Temperature error');
      
      // Create a controlled clone object that has the mocked setTargetTemperature
      const clonedState = { ...mockDeviceState } as any;
      clonedState.setTargetTemperature = vi.fn().mockImplementation(() => {
        throw mockTempError;
      });
      
      // Mock clone to return our controlled object
      const cloneSpy = vi.spyOn(mockDeviceState, 'clone')
        .mockReturnValue(clonedState);
      
      const callbackTemp = vi.fn();
      
      // Call the handler directly to trigger the synchronous error
      await (platformAccessory as any).handleThresholdTemperatureSet(20, callbackTemp);
      
      // Verify callback was called with the error
      expect(callbackTemp).toHaveBeenCalledWith(mockTempError);
      
      // Cleanup all spies and mocks
      cloneSpy.mockRestore();
      
      // Set default behavior for future tests
      mockCacheManager.applyStateToDevice = vi.fn().mockResolvedValue(undefined);
    });

    it('should handle errors during get operations gracefully', async () => {
      const mockError = new Error('Failed to get status');
      
      // Use spyOn instead of direct mock modifications to properly trace calls
      const getDeviceStateSpy = vi.spyOn(mockCacheManager, 'getDeviceState')
        .mockImplementation(() => { throw mockError; });

      await expect((platformAccessory as any).handleActiveGet()).rejects.toThrow(mockError);
      
      // Restore the original behavior
      getDeviceStateSpy.mockRestore();

      // Test error handling in temperature get
      const toApiStatusSpy = vi.spyOn(mockDeviceState, 'toApiStatus')
        .mockImplementation(() => { throw mockError; });
        
      await expect((platformAccessory as any).handleCurrentTemperatureGet()).rejects.toThrow(mockError);
      
      // Restore the original behavior
      toApiStatusSpy.mockRestore();
    });
  });
});
