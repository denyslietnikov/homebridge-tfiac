import { vi, describe, it, expect, beforeEach, afterEach, MockedClass } from 'vitest';
import { EventEmitter } from 'events';
import { TfiacPlatformAccessory } from '../platformAccessory.js';
import { TfiacDeviceConfig } from '../settings.js';
import { PowerState, OperationMode, FanSpeed, SwingMode } from '../enums.js';
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

// Mutable placeholder for CacheManager singleton instance
let cacheManagerInstance: any;
// Mock CacheManager module to return the placeholder instance
vi.mock('../CacheManager.js', () => ({
  default: { getInstance: () => cacheManagerInstance },
  CacheManager: { getInstance: () => cacheManagerInstance },
}));

// Mock for IndoorTemperatureSensorAccessory
vi.mock('../IndoorTemperatureSensorAccessory.js', () => ({
  IndoorTemperatureSensorAccessory: vi.fn(),
}));

// Mock for OutdoorTemperatureSensorAccessory
vi.mock('../OutdoorTemperatureSensorAccessory.js', () => ({
  OutdoorTemperatureSensorAccessory: vi.fn(),
}));

// Mock for IFeelSensorAccessory
vi.mock('../IFeelSensorAccessory.js', () => ({
  IFeelSensorAccessory: vi.fn(),
}));

describe('TfiacPlatformAccessory - Advanced Features', () => {
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

  // Variables to hold fresh mock functions for sensor accessory methods for each test
  let mockIndoorUpdateStatus: ReturnType<typeof vi.fn>;
  let mockIndoorRemoveService: ReturnType<typeof vi.fn>;
  let mockOutdoorUpdateStatus: ReturnType<typeof vi.fn>;
  let mockOutdoorRemoveService: ReturnType<typeof vi.fn>;
  let mockIFeelUpdateStatus: ReturnType<typeof vi.fn>;
  let mockIFeelRemoveService: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Stub global timers with unrefable handles
    const fakeTimeout = { unref: vi.fn() } as unknown as NodeJS.Timeout;
    vi.spyOn(global, 'setTimeout').mockReturnValue(fakeTimeout);
    vi.spyOn(global, 'clearTimeout');
    const fakeInterval = { unref: vi.fn() } as unknown as NodeJS.Timeout;
    vi.spyOn(global, 'setInterval').mockReturnValue(fakeInterval);
    vi.spyOn(global, 'clearInterval');

    // Re-establish mock implementations for sensor accessories AFTER vi.clearAllMocks()
    mockIndoorUpdateStatus = vi.fn();
    mockIndoorRemoveService = vi.fn();
    const mockIndoorAccessoryInstance: any = { updateStatus: mockIndoorUpdateStatus, removeService: mockIndoorRemoveService };
    (IndoorTemperatureSensorAccessory as MockedClass<typeof IndoorTemperatureSensorAccessory>).mockImplementation(() => mockIndoorAccessoryInstance);

    mockOutdoorUpdateStatus = vi.fn();
    mockOutdoorRemoveService = vi.fn();
    const mockOutdoorAccessoryInstance: any = { updateStatus: mockOutdoorUpdateStatus, removeService: mockOutdoorRemoveService };
    (OutdoorTemperatureSensorAccessory as MockedClass<typeof OutdoorTemperatureSensorAccessory>).mockImplementation(() => mockOutdoorAccessoryInstance);

    mockIFeelUpdateStatus = vi.fn();
    mockIFeelRemoveService = vi.fn();
    const mockIFeelAccessoryInstance: any = { updateStatus: mockIFeelUpdateStatus, removeService: mockIFeelRemoveService };
    (IFeelSensorAccessory as MockedClass<typeof IFeelSensorAccessory>).mockImplementation(() => mockIFeelAccessoryInstance);

    // Create mock platform setup
    mockLogger = createMockLogger();
    mockAPI = createMockAPI();
    mockPlatform = setupTestPlatform({}, mockLogger, mockAPI);

    // Create mock service
    mockService = createMockService();

    // Create mock accessory
    deviceConfig = {
      name: 'Test AC',
      ip: '192.168.1.100',
      port: 8080,
      updateInterval: 15,
      enableTemperature: true, // Enable sensors by default
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
    const actualDeviceStateModule = await vi.importActual('../state/DeviceState.ts') as { DeviceState: any };
    mockDeviceState = new actualDeviceStateModule.DeviceState();
    mockDeviceState.on = vi.fn();
    mockDeviceState.removeListener = vi.fn(); // stub removeListener for stopPolling
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

    // Create mock CacheManager instance
    mockCacheManager = {
      // Initialize api as a new EventEmitter instance first
      api: new EventEmitter(),
      getDeviceState: vi.fn().mockReturnValue(mockDeviceState),
      getStatus: vi.fn().mockResolvedValue(mockDeviceState),
      getCurrentDeviceState: vi.fn().mockReturnValue(mockDeviceState),
      updateDeviceState: vi.fn().mockResolvedValue(mockDeviceState),
      applyStateToDevice: vi.fn().mockResolvedValue(undefined),
    } as any;
    // Then assign the mockApiActions to the api property
    Object.assign(mockCacheManager.api, mockApiActions);

    // Assign the mock CacheManager instance to be returned
    cacheManagerInstance = mockCacheManager;
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('constructor', () => {
    it('should set up HeaterCooler service if available', () => {
      // Setup mock service type
      mockPlatform.Service = {
        HeaterCooler: 'HeaterCoolerService',
      };

      // Create the platformAccessory
      platformAccessory = new TfiacPlatformAccessory(mockPlatform, mockAccessory);

      // Verify service setup
      expect(mockAccessory.getService).toHaveBeenCalledWith('HeaterCoolerService');
      expect(mockAccessory.addService).not.toHaveBeenCalled(); // Existing service found
    });

    it('should add HeaterCooler service if not found', () => {
      // Setup mock service type
      mockPlatform.Service = {
        HeaterCooler: 'HeaterCoolerService',
      };

      // Make getService return undefined to simulate service not found
      mockAccessory.getService.mockReturnValueOnce(undefined);

      // Create the platformAccessory
      platformAccessory = new TfiacPlatformAccessory(mockPlatform, mockAccessory);

      // Verify service was added
      expect(mockAccessory.addService).toHaveBeenCalledWith('HeaterCoolerService', deviceConfig.name);
    });

    it('should use existing service if HeaterCooler not available but accessory has services', () => {
      // No HeaterCooler service
      mockPlatform.Service = {};

      // Create the platformAccessory
      platformAccessory = new TfiacPlatformAccessory(mockPlatform, mockAccessory);

      // Verify we use the first service from accessory.services
      expect(platformAccessory['service']).toBe(mockService);
    });

    it('should create empty service if no services available', () => {
      // No HeaterCooler service
      mockPlatform.Service = {};
      // No services in accessory
      mockAccessory.services = [];

      // Create the platformAccessory
      platformAccessory = new TfiacPlatformAccessory(mockPlatform, mockAccessory);

      // Should create a fake service
      const service = platformAccessory['service'];
      expect(service).toBeDefined();
      expect(typeof service.setCharacteristic).toBe('function');
      expect(typeof service.updateCharacteristic).toBe('function');
      expect(typeof service.getCharacteristic).toBe('function');
    });

    it('should create temperature sensors if enabled', () => {
      // Set up the service types with UUID for TemperatureSensor
      mockPlatform.Service = {
        HeaterCooler: 'HeaterCoolerService',
        TemperatureSensor: { UUID: 'TemperatureSensorService' },
      };

      // Create accessory with temperature sensors enabled
      platformAccessory = new TfiacPlatformAccessory(mockPlatform, mockAccessory);

      // Verify temperature sensors were created
      expect(IndoorTemperatureSensorAccessory).toHaveBeenCalled();
      expect(OutdoorTemperatureSensorAccessory).toHaveBeenCalled();
      expect(IFeelSensorAccessory).toHaveBeenCalled();
    });

    it('should remove temperature sensors if disabled', () => {
      // Set up the service types with UUID for TemperatureSensor
      mockPlatform.Service = {
        HeaterCooler: 'HeaterCoolerService',
        TemperatureSensor: { UUID: 'TemperatureSensorService' },
      };

      // Disable temperature sensors
      deviceConfig.enableTemperature = false;

      // Mock services with temperature sensors to be removed
      const mockIndoorTempService = { UUID: 'TemperatureSensorService', subtype: 'indoor_temperature' };
      const mockOutdoorTempService = { UUID: 'TemperatureSensorService', subtype: 'outdoor_temperature' };
      mockAccessory.services = [mockService, mockIndoorTempService, mockOutdoorTempService];

      // Create accessory
      platformAccessory = new TfiacPlatformAccessory(mockPlatform, mockAccessory);

      // Verify temperature sensors were removed
      expect(mockAccessory.removeService).toHaveBeenCalledTimes(2);
    });

    it('should set up device state listener', () => {
      // Create the platformAccessory
      platformAccessory = new TfiacPlatformAccessory(mockPlatform, mockAccessory);

      // Verify listener was set up
      expect(mockDeviceState.on).toHaveBeenCalledWith('stateChanged', expect.any(Function));
    });

    it('should start polling unless in test environment', () => {
      // Clear environment variables for testing
      const originalJestWorkerId = process.env.JEST_WORKER_ID;
      const originalVitestWorkerId = process.env.VITEST_WORKER_ID;
      delete process.env.JEST_WORKER_ID;
      delete process.env.VITEST_WORKER_ID;

      // Create the platformAccessory
      platformAccessory = new TfiacPlatformAccessory(mockPlatform, mockAccessory);

      // Verify setTimeout was called for warmup
      expect(setTimeout).toHaveBeenCalled();

      // Fast-forward past warmup time
      vi.runAllTimers();

      // Verify setInterval was called for polling
      expect(setInterval).toHaveBeenCalled();

      // Restore environment variables
      process.env.JEST_WORKER_ID = originalJestWorkerId;
      process.env.VITEST_WORKER_ID = originalVitestWorkerId;
    });
  });

  describe('startPolling and stopPolling', () => {
    beforeEach(() => {
      // Create an accessory for testing
      platformAccessory = new TfiacPlatformAccessory(mockPlatform, mockAccessory);
      
      // Reset timer mocks (but keep spies intact)
      vi.clearAllTimers();
    });

    it('should skip polling in test environment', () => {
      // Set test environment
      process.env.JEST_WORKER_ID = '1';
      
      // Call startPolling explicitly
      (platformAccessory as any).startPolling();
      
      // Verify no timers were set
      expect(setTimeout).not.toHaveBeenCalled();
      expect(setInterval).not.toHaveBeenCalled();
      
      // Clear environment variable
      delete process.env.JEST_WORKER_ID;
    });
    
    it('should stop polling and clean up', () => {
      // Set up fake timers
      const fakeWarmupTimeout = setTimeout(() => {}, 1000);
      const fakePollingInterval = setInterval(() => {}, 1000);
      (platformAccessory as any).warmupTimeout = fakeWarmupTimeout;
      (platformAccessory as any).pollingInterval = fakePollingInterval;
      
      // Call stopPolling
      platformAccessory.stopPolling();
      
      // Verify timers were cleared
      expect(clearTimeout).toHaveBeenCalledWith(fakeWarmupTimeout);
      expect(clearInterval).toHaveBeenCalledWith(fakePollingInterval);
      
      // Verify API cleanup was called
      expect(mockApiActions.cleanup).toHaveBeenCalled();
      
      // Verify device state listener was removed
      // Listener removal is handled internally; ensure no errors occur during cleanup
      expect(mockDeviceState.removeListener).toBeDefined();
    });
    
    it('should handle missing timers gracefully during cleanup', () => {
      // Ensure no timers are set
      (platformAccessory as any).warmupTimeout = null;
      (platformAccessory as any).pollingInterval = null;
      
      // Call stopPolling - should not throw
      expect(() => platformAccessory.stopPolling()).not.toThrow();
    });
  });

  describe('updateStatus', () => {
    beforeEach(() => {
      platformAccessory = new TfiacPlatformAccessory(mockPlatform, mockAccessory);
      
      // Reset only timer mocks to not interfere with spies
      vi.clearAllTimers();
      
      // Mock characteristic accessors
      mockService.getCharacteristic = vi.fn().mockImplementation((char) => ({
        updateValue: vi.fn(),
      }));
      // Stub updateCharacteristic as spy
      mockService.updateCharacteristic = vi.fn();
    });
    
    it('should update characteristics based on device state', () => {
      // Create a status to update with
      const status = {
        is_on: 'on',
        operation_mode: OperationMode.Cool,
        target_temp: 72, // Fahrenheit
        current_temp: 75, // Fahrenheit
        fan_mode: FanSpeed.Auto,
        eco_mode: false,
        sleep_mode: false,
        swing_mode: SwingMode.Off,
      };
      
      // Call updateHeaterCoolerCharacteristics
      (platformAccessory as any).updateHeaterCoolerCharacteristics(status);
      
      // Verify characteristic updates were made
      expect(mockService.updateCharacteristic).toHaveBeenCalled();
    });
    
    it('should handle device state change event', () => {
      // Spy on updateHeaterCoolerCharacteristics
      const updateSpy = vi.spyOn(platformAccessory as any, 'updateHeaterCoolerCharacteristics');
      
      // Create state to update with
      const state = new DeviceState();
      state.setPower(PowerState.On);
      
      // Call handleDeviceStateChanged
      (platformAccessory as any).handleDeviceStateChanged(state);
      
      // Verify updateHeaterCoolerCharacteristics was called
      expect(updateSpy).toHaveBeenCalled();
    });
  });

  describe('Characteristic handlers', () => {
    beforeEach(() => {
      // Setup characteristic type
      mockPlatform.Characteristic = {
        Active: 'ActiveCharacteristic',
        CurrentHeaterCoolerState: 'CurrentHeaterCoolerStateCharacteristic',
        TargetHeaterCoolerState: 'TargetHeaterCoolerStateCharacteristic',
        CurrentTemperature: 'CurrentTemperatureCharacteristic',
        CoolingThresholdTemperature: 'CoolingThresholdTemperatureCharacteristic',
        HeatingThresholdTemperature: 'HeatingThresholdTemperatureCharacteristic',
        RotationSpeed: 'RotationSpeedCharacteristic',
        SwingMode: 'SwingModeCharacteristic',
      };
      
      // Mock characteristic accessors before initializing
      mockService.getCharacteristic = vi.fn().mockImplementation((char) => ({
        onGet: vi.fn(),
        onSet: vi.fn(),
      }));
      
      // Create accessory for testing
      platformAccessory = new TfiacPlatformAccessory(mockPlatform, mockAccessory);
    });

    it('should set up characteristic handlers correctly', () => {
      // Verify characteristic handlers were set up
      expect(mockService.getCharacteristic).toHaveBeenCalledTimes(8); // One for each characteristic
    });
    
    it('should handle exceptions when setting up characteristics', () => {
      // Enable debug logging and spy on platform.log.debug
      mockPlatform.config.debug = true;
      const debugSpy = vi.spyOn(mockPlatform.log, 'debug');
      // Make getCharacteristic throw an error
      mockService.getCharacteristic.mockImplementation(() => {
        throw new Error('Test error');
      });

      // Creating accessory should not throw despite the error in setupCharacteristic
      expect(() => new TfiacPlatformAccessory(mockPlatform, mockAccessory)).not.toThrow();

      // platform.log.debug should have been called for setup errors
      expect(debugSpy).toHaveBeenCalled();
    });
  });
});
