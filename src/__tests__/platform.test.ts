// platform.test.ts

import { vi, describe, beforeEach, it, expect, afterEach } from 'vitest';
import { PlatformAccessory, Service, Characteristic } from 'homebridge';
import { TfiacDeviceConfig, TfiacPlatformConfig } from '../settings.js';
import { PLUGIN_NAME, PLATFORM_NAME } from '../settings.js';

// Mock fs/promises and path before imports
vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockRejectedValue(new Error('ENOENT: no such file or directory, open \'/mock/storage/path/homebridge-tfiac-version.json\'')),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('path', () => ({
  join: vi.fn((...args: string[]) => args.join('/')),
}));

// Mock implementations before imports
vi.mock('../DrySwitchAccessory.js', () => ({ DrySwitchAccessory: vi.fn() }));
vi.mock('../FanOnlySwitchAccessory.js', () => ({ FanOnlySwitchAccessory: vi.fn() }));
vi.mock('../StandaloneFanAccessory.js', () => ({ StandaloneFanAccessory: vi.fn() }));
vi.mock('../HorizontalSwingSwitchAccessory.js', () => ({ HorizontalSwingSwitchAccessory: vi.fn() }));
vi.mock('../TurboSwitchAccessory.js', () => ({ TurboSwitchAccessory: vi.fn() }));
vi.mock('../EcoSwitchAccessory.js', () => ({ EcoSwitchAccessory: vi.fn() }));
vi.mock('../BeepSwitchAccessory.js', () => ({ BeepSwitchAccessory: vi.fn() }));
vi.mock('../DisplaySwitchAccessory.js', () => ({ DisplaySwitchAccessory: vi.fn() }));
vi.mock('../SleepSwitchAccessory.js', () => ({ SleepSwitchAccessory: vi.fn() }));

// Import the libraries that are mocked above
import { API, Logger, User, Categories, LegacyTypes } from 'homebridge';
import { TfiacPlatform } from '../platform.js';
import { TfiacPlatformAccessory } from '../platformAccessory.js';

import {
  createMockLogger,
  createMockService,
  createMockCharacteristic,
  createMockPlatformAccessory,
} from './testUtils.js';

// Ensure this mockLogger is a full vi.fn mock to enable spy checking
const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn((...args: unknown[]) => {
    // Log to console for visibility during test run
    const errorArgs = args.map(arg => 
      arg instanceof Error ? { message: arg.message, stack: arg.stack } : arg
    );
    console.error('mockLogger.error called with:', JSON.stringify(errorArgs, null, 2));
  }),
  log: vi.fn(),
  success: vi.fn()
};

// Collection to store TfiacPlatformAccessory instances for cleanup
const tfiacAccessoryInstances: TfiacPlatformAccessory[] = [];

// Collection to store mock accessory instances for cleanup
const tfiacAccessoryInstancesForCleanup: TfiacPlatformAccessory[] = [];

// Type for mock with cleanupInstances method
interface TfiacPlatformAccessoryMockStatic {
  cleanupInstances?: () => void;
}

// Mock the TfiacPlatformAccessory module
vi.mock('../platformAccessory.js', () => {
  const MockTfiacAccessory = vi.fn().mockImplementation((platform, accessory) => {
    const instance = {
      accessory: accessory,
      platform: platform,
      stopPolling: vi.fn(),
      startPolling: vi.fn(),
    };
    tfiacAccessoryInstancesForCleanup.push(instance as unknown as TfiacPlatformAccessory);
    return instance as unknown as TfiacPlatformAccessory;
  });
  
  (MockTfiacAccessory as TfiacPlatformAccessoryMockStatic).cleanupInstances = () => {
    tfiacAccessoryInstancesForCleanup.forEach(inst => {
      if (inst && typeof inst.stopPolling === 'function') {
        inst.stopPolling();
      }
    });
    tfiacAccessoryInstancesForCleanup.length = 0;
  };
  
  return {
    __esModule: true,
    TfiacPlatformAccessory: MockTfiacAccessory,
  };
});

// Declare didFinishLaunchingCallback at the module level
let didFinishLaunchingCallback: () => void = () => {};

// Mock Service instance
const mockServiceInstance = createMockService();

// Fix write mock function type
type WriteFunction = {
  (uuid: string): Buffer;
  (uuid: string, buf: Buffer, offset: number): void;
};

const mockWrite: ReturnType<typeof vi.fn> = vi.fn((uuid: string, buf?: Buffer, offset?: number) => {
  if (buf === undefined || offset === undefined) {
    return Buffer.from([]);
  }
}) as ReturnType<typeof vi.fn>;

// Fix Categories mock: use a specific numeric value
const mockCategories = {
  AIR_CONDITIONER: 22,
} as Record<keyof typeof Categories, number>;

// Cast the mockAPI object to type API, adding a minimal set of properties,
const mockAPI: API = {
  hap: {
    uuid: {
      BASE_UUID: '-0000-1000-8000-0026BB765291',
      generate: vi.fn().mockReturnValue('mock-uuid'),
      isValid: vi.fn().mockReturnValue(true),
      unparse: vi.fn().mockReturnValue('mock-uuid'),
      write: mockWrite,
      toShortForm: vi.fn().mockReturnValue('mock-uuid'),
      toLongForm: vi.fn().mockReturnValue('mock-uuid'),
    },
    Service: {
      prototype: {},
      Thermostat: vi.fn(() => mockServiceInstance),
      HeaterCooler: vi.fn(() => mockServiceInstance),
      AccessoryInformation: Object.assign(vi.fn(() => mockServiceInstance), { UUID: 'accessory-information-uuid' }),
      // Add missing service mocks with UUID properties
      Switch: Object.assign(vi.fn(() => createMockService('Switch')), { UUID: 'switch-uuid' }),
      Fanv2: Object.assign(vi.fn(() => createMockService('Fanv2')), { UUID: 'fanv2-uuid' }),
      Fan: Object.assign(vi.fn(() => createMockService('Fan')), { UUID: 'fan-uuid' }), // For StandaloneFanAccessory if it uses Service.Fan
      TemperatureSensor: Object.assign(vi.fn(() => createMockService('TemperatureSensor')), { UUID: 'temperature-sensor-uuid' }),
    } as unknown as typeof Service,
    Characteristic: {
      prototype: {},
      CurrentTemperature: vi.fn(() => createMockCharacteristic()),
      TargetTemperature: vi.fn(() => createMockCharacteristic()),
      TemperatureDisplayUnits: vi.fn(() => createMockCharacteristic()),
      Active: vi.fn(() => createMockCharacteristic()),
      CurrentHeaterCoolerState: vi.fn(() => createMockCharacteristic()),
      TargetHeaterCoolerState: vi.fn(() => createMockCharacteristic()),
      SwingMode: vi.fn(() => createMockCharacteristic()),
      RotationSpeed: vi.fn(() => createMockCharacteristic()),
      CoolingThresholdTemperature: vi.fn(() => createMockCharacteristic()),
      HeatingThresholdTemperature: vi.fn(() => createMockCharacteristic()),
      Name: vi.fn(() => createMockCharacteristic()),
      Manufacturer: vi.fn(() => createMockCharacteristic()),
      Model: vi.fn(() => createMockCharacteristic()),
      SerialNumber: vi.fn(() => createMockCharacteristic()),
    } as unknown as typeof Characteristic,
    Categories: mockCategories,
    HAPLibraryVersion: { major: 1, minor: 0 },
    LegacyTypes: {} as typeof LegacyTypes,
    _definitions: {},
    HAPStorage: vi.fn(),
  } as unknown as typeof import('hap-nodejs'),
  on: vi.fn().mockImplementation((event: unknown, callback: unknown) => {
    if (event === 'didFinishLaunching' && typeof callback === 'function') {
      didFinishLaunchingCallback = callback as () => void;
    }
    return mockAPI;
  }),
  platformAccessory: vi.fn((displayName: string, uuid: string) => createMockPlatformAccessory(displayName, uuid)),
  registerPlatformAccessories: vi.fn(),
  updatePlatformAccessories: vi.fn(),
  unregisterPlatformAccessories: vi.fn(),
  version: 1,
  serverVersion: 'mock-server-version',
  user: {
    configPath: () => '/mock/config/path',
    storagePath: () => '/mock/storage/path',
    prototype: {},
    persistPath: '/mock/persist/path',
    cachedAccessoryPath: () => '/mock/cached/accessory/path',
    setStoragePath: vi.fn(),
  } as unknown as typeof User,
  hapLegacyTypes: {}, // Use an empty object as LegacyTypes is a type
  versionGreaterOrEqual: vi.fn().mockReturnValue(true),
  registerAccessory: vi.fn(),
  registerPlatform: vi.fn(),
  publishExternalAccessories: vi.fn(),
} as unknown as API;

// Use simpler mock for homebridge
vi.mock('homebridge', () => ({
  API: vi.fn(),
  Categories: vi.fn(),
  Characteristic: vi.fn(),
  Logger: vi.fn(),
  PlatformAccessory: vi.fn().mockImplementation((name, uuid) => {
    return {
      context: {},
      UUID: uuid,
      displayName: name,
    };
  }),
  PlatformConfig: vi.fn(),
  Service: vi.fn(),
  User: vi.fn(),
}));

describe('TfiacPlatform', () => {
  let platform: TfiacPlatform;
  let config: TfiacPlatformConfig;
  // Store accessory instances for cleanup
  let accessoryInstances: PlatformAccessory[] = [];

  beforeEach(() => {
    // Reset all mocks
    // Clear all mocks
    vi.clearAllMocks();

    // Logger mocks are cleared globally via clearAllMocks

    // Reset API mocks specifically
    (mockAPI.registerPlatformAccessories as ReturnType<typeof vi.fn>).mockReset();
    (mockAPI.updatePlatformAccessories as ReturnType<typeof vi.fn>).mockReset();
    (mockAPI.unregisterPlatformAccessories as ReturnType<typeof vi.fn>).mockReset();
    (mockAPI.hap.uuid.generate as ReturnType<typeof vi.fn>).mockReset().mockReturnValue('mock-uuid');

    // Clear stored accessory instances
    accessoryInstances = [];
    // Clear TfiacPlatformAccessory instances
    tfiacAccessoryInstances.length = 0;

    // Capture accessory instances for cleanup
    (mockAPI.registerPlatformAccessories as ReturnType<typeof vi.fn>).mockImplementation(
      (...args: unknown[]) => {
        if (args.length >= 3 && Array.isArray(args[2])) {
          accessoryInstances.push(...args[2] as PlatformAccessory[]);
        }
        return undefined;
      },
    );

    // Base platform configuration with a valid device
    config = {
      platform: 'TfiacPlatform',
      name: 'Test Platform',
      devices: [
        {
          name: 'Test AC',
          ip: '192.168.1.100',
          port: 7777,
          updateInterval: 30,
        },
      ],
      enableDiscovery: false,
    };

    // Mock API on method implementation
    (mockAPI.on as ReturnType<typeof vi.fn>).mockImplementation((event: string, callback: () => void) => {
      if (event === 'didFinishLaunching') {
        didFinishLaunchingCallback = callback as () => void;
      }
      return mockAPI;
    });

    // Initialize platform AFTER setting up the mock implementation for registerPlatformAccessories
    platform = new TfiacPlatform(mockLogger, config, mockAPI);

    // Use vi.clearAllMocks() instead of individual mockClear calls
    // This already happened at the beginning of beforeEach
  });

  // Clean up after each test
  afterEach(async () => {
    // Clean up any registered accessories
    accessoryInstances.forEach(() => {
      // No need to check for _associatedTfiacAccessory property anymore
    });
    accessoryInstances.length = 0;

    // Clean up TfiacPlatformAccessory instances
    tfiacAccessoryInstances.forEach(instance => {
      if (typeof instance.stopPolling === 'function') {
        instance.stopPolling();
      }
    });
    tfiacAccessoryInstances.length = 0;

    // Guaranteed cleanup of mock accessories
    const { TfiacPlatformAccessory: ActualMock } = await vi.importMock('../platformAccessory.js');
    if ((ActualMock as any).cleanupInstances) {
      (ActualMock as any).cleanupInstances();
    }

    vi.clearAllMocks();
  });

  // ---------- Rewritten platform tests ----------
  it('does not register accessories upon construction', () => {
    // Platform is constructed in beforeEach, but discoverDevices is not called by constructor
    expect(mockAPI.registerPlatformAccessories).not.toHaveBeenCalled();
  });

  it('registers new accessories on didFinishLaunching', async () => {
    // Platform is constructed in beforeEach
    expect(mockAPI.registerPlatformAccessories).not.toHaveBeenCalled(); // Ensure not called yet

    if (!didFinishLaunchingCallback) {
      throw new Error('didFinishLaunchingCallback was not set by mockAPI.on');
    }
    await didFinishLaunchingCallback(); // This will call platform.discoverDevices()

    expect(mockLogger.error).not.toHaveBeenCalled(); // Check for errors first
    expect(mockAPI.registerPlatformAccessories).toHaveBeenCalledTimes(1);
    expect(mockAPI.registerPlatformAccessories).toHaveBeenCalledWith(
      PLUGIN_NAME,
      PLATFORM_NAME,
      accessoryInstances, // This array is populated by the mockImplementation
    );
    // Assuming one device in the default config from beforeEach
    expect(accessoryInstances.length).toBe(1);
    if (config.devices && config.devices.length > 0) {
      expect(accessoryInstances[0].displayName).toBe(config.devices[0].name);
    }
  });

  it('registers new accessories when discoverDevices is called directly', async () => {
    // Platform is constructed in beforeEach
    expect(mockAPI.registerPlatformAccessories).not.toHaveBeenCalled(); // Ensure not called yet

    await platform.discoverDevices();

    expect(mockLogger.error).not.toHaveBeenCalled(); // Check for errors first
    expect(mockAPI.registerPlatformAccessories).toHaveBeenCalledTimes(1);
    expect(mockAPI.registerPlatformAccessories).toHaveBeenCalledWith(
      PLUGIN_NAME,
      PLATFORM_NAME,
      accessoryInstances,
    );
    expect(accessoryInstances.length).toBe(1);
    if (config.devices && config.devices.length > 0) {
      expect(accessoryInstances[0].displayName).toBe(config.devices[0].name);
    }
  });

  it('does not re-register accessories if discoverDevices is called multiple times', async () => {
    // First call (e.g., via didFinishLaunching)
    if (!didFinishLaunchingCallback) {
      throw new Error('didFinishLaunchingCallback was not set by mockAPI.on');
    }
    await didFinishLaunchingCallback();
    
    expect(mockLogger.error).not.toHaveBeenCalled(); // Check for errors first
    expect(mockAPI.registerPlatformAccessories).toHaveBeenCalledTimes(1);
    
    // Clear mocks for the next call
    (mockAPI.registerPlatformAccessories as ReturnType<typeof vi.fn>).mockClear();
    accessoryInstances.length = 0; // Clear the capture array

    // Second call (e.g., direct call to discoverDevices)
    await platform.discoverDevices();
    expect(mockLogger.error).not.toHaveBeenCalled(); // Check for errors first
    expect(mockAPI.registerPlatformAccessories).not.toHaveBeenCalled(); // Should not register again
    expect(accessoryInstances.length).toBe(0); // No new accessories should have been pushed

    // Third call (another direct call to be sure)
    (mockAPI.registerPlatformAccessories as ReturnType<typeof vi.fn>).mockClear(); // Clear again just in case
    accessoryInstances.length = 0;
    await platform.discoverDevices();
    expect(mockLogger.error).not.toHaveBeenCalled(); // Check for errors first
    expect(mockAPI.registerPlatformAccessories).not.toHaveBeenCalled();
    expect(accessoryInstances.length).toBe(0);
  });

  it('shows debug logs when debug flag is set to true', async () => {
    vi.clearAllMocks();
    
    // Create a new platform instance with debug enabled
    const debugConfig: TfiacPlatformConfig = { ...config, debug: true };
    const debugPlatform = new TfiacPlatform(mockLogger, debugConfig, mockAPI);
    // Spy on the wrapper debug method
    const wrapperSpy = vi.spyOn(mockLogger, 'debug');
    
    // Log a debug message
    debugPlatform.log.debug('Test debug message');
    
    // Verify the wrapper debug was called
    expect(wrapperSpy).toHaveBeenCalledWith('Test debug message');
  });
  
  it('does not show debug logs when debug flag is not set', async () => {
    vi.clearAllMocks();
    
    // Create a clean mockLogger with a spy already in place
    const testMockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
      success: vi.fn()
    };
    
    // Directly spy on the debug method before creating the platform
    const wrapperSpy = vi.spyOn(testMockLogger, 'debug');
    
    // Create a new platform instance with debug explicitly disabled
    const noDebugConfig: TfiacPlatformConfig = { ...config, debug: false };
    const noDebugPlatform = new TfiacPlatform(testMockLogger, noDebugConfig, mockAPI);
    
    // Log a debug message
    noDebugPlatform.log.debug('Test debug message');
    
    // Verify the wrapper debug was not called
    expect(wrapperSpy).not.toHaveBeenCalled();
  });

  it('shows debug logs when any device has debug flag set to true', async () => {
    vi.clearAllMocks();
    
    // Create a new platform instance with platform debug disabled but device debug enabled
    const deviceDebugConfig: TfiacPlatformConfig = {
      ...config,
      debug: false,
      devices: [ { ...config.devices![0], debug: true } ]
    };
    const deviceDebugPlatform = new TfiacPlatform(mockLogger, deviceDebugConfig, mockAPI);
    // Spy on the wrapper debug method
    const wrapperSpy = vi.spyOn(mockLogger, 'debug');
    
    // Log a debug message
    deviceDebugPlatform.log.debug('Test debug message');
    
    // Verify the wrapper debug was called
    expect(wrapperSpy).toHaveBeenCalledWith('Test debug message');
  });
});