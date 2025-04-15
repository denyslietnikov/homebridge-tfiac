// platform.test.ts

import { API, Categories, Characteristic, Logger, PlatformAccessory, PlatformConfig, Service, User } from 'homebridge';
import { TfiacPlatform } from '../platform';
import { jest, describe, beforeEach, it, expect, afterEach } from '@jest/globals';
import { Accessory, LegacyTypes } from 'hap-nodejs';
import { TfiacPlatformAccessory } from '../platformAccessory';

// Collection to store TfiacPlatformAccessory instances for cleanup
const tfiacAccessoryInstances: TfiacPlatformAccessory[] = [];

// Mock the TfiacPlatformAccessory module
jest.mock('../platformAccessory', () => {
  const originalModule = jest.requireActual('../platformAccessory') as { 
    TfiacPlatformAccessory: typeof TfiacPlatformAccessory 
  };
  
  return {
    __esModule: true,
    TfiacPlatformAccessory: jest.fn().mockImplementation((platform, accessory) => {
      const instance = new originalModule.TfiacPlatformAccessory(platform as TfiacPlatform, accessory as PlatformAccessory);
      tfiacAccessoryInstances.push(instance);
      return instance;
    }),
  };
});

// Declare didFinishLaunchingCallback at the module level
let didFinishLaunchingCallback: () => void = () => {};

// Mock Service instance
const mockServiceInstance = {
  on: jest.fn().mockReturnThis(),
  setCharacteristic: jest.fn().mockReturnThis(),
  updateCharacteristic: jest.fn().mockReturnThis(),
  getCharacteristic: jest.fn().mockReturnValue({
    on: jest.fn().mockReturnThis(),
    setProps: jest.fn().mockReturnThis(),
    setValue: jest.fn().mockReturnThis(),
    updateValue: jest.fn().mockReturnThis(),
  }),
  emit: jest.fn(),
  displayName: 'Mock Service',
  UUID: 'mock-uuid',
  iid: 1,
  characteristics: [],
  optionalCharacteristics: [],
  isHiddenService: false,
  isPrimaryService: false,
  linked: [],
} as unknown as Service;

// Interface for the mocked PlatformAccessory (minimal set)
interface MockedPlatformAccessory extends Omit<PlatformAccessory, 'getService' | 'addService'> {
  displayName: string;
  UUID: string;
  getService(service: typeof Service): Service | undefined;
  addService(service: typeof Service, name?: string): Service;
  context: Record<string, unknown>;
}

// Minimal implementation of the mocked accessory
class MockPlatformAccessory implements Partial<MockedPlatformAccessory> {
  displayName: string;
  UUID: string;
  context: Record<string, unknown>;
  category?: Categories;
  // Return our mockServiceInstance
  getService = jest.fn<(service: typeof Service) => Service | undefined>().mockReturnValue(mockServiceInstance);
  addService = jest.fn<(service: typeof Service, name?: string) => Service>().mockReturnValue(mockServiceInstance);
  services: Service[] = [];
  // For _associatedHAPAccessory, assign a minimal value with type assertion
  _associatedHAPAccessory: Accessory = {} as Accessory;
  // Define the on and emit methods as functions without strict typing
  on = jest.fn<(event: 'identify', listener: () => void) => PlatformAccessory>().mockReturnThis();
  emit = jest.fn<(event: 'identify') => boolean>().mockReturnValue(true);

  constructor(displayName: string, uuid: string) {
    this.displayName = displayName;
    this.UUID = uuid;
    this.context = {};
  }
}

// Mock static methods of PlatformAccessory
const mockStatic = {
  serialize: jest.fn().mockReturnValue({}),
  deserialize: jest.fn().mockReturnValue(new MockPlatformAccessory('', '')),
  prototype: new MockPlatformAccessory('', ''),
};

// Create a mocked constructor for PlatformAccessory with added static properties
const mockPlatformAccessory = Object.assign(
  jest.fn((displayName: string, uuid: string) => new MockPlatformAccessory(displayName, uuid)),
  mockStatic,
) as unknown as typeof PlatformAccessory;

// Mock Service and Characteristic
const mockCharacteristicInstance = {
  on: jest.fn().mockReturnThis(),
  setProps: jest.fn().mockReturnThis(),
  setValue: jest.fn().mockReturnThis(),
  updateValue: jest.fn().mockReturnThis(),
};

const mockService = {
  prototype: {},
  Thermostat: jest.fn(() => mockServiceInstance),
  HeaterCooler: jest.fn(() => mockServiceInstance),
  AccessoryInformation: jest.fn(() => mockServiceInstance),
} as unknown as typeof Service;

const mockCharacteristic = {
  prototype: {},
  CurrentTemperature: jest.fn(() => mockCharacteristicInstance),
  TargetTemperature: jest.fn(() => mockCharacteristicInstance),
  TemperatureDisplayUnits: jest.fn(() => mockCharacteristicInstance),
  Active: jest.fn(() => mockCharacteristicInstance),
  CurrentHeaterCoolerState: jest.fn(() => mockCharacteristicInstance),
  TargetHeaterCoolerState: jest.fn(() => mockCharacteristicInstance),
  SwingMode: jest.fn(() => mockCharacteristicInstance),
  RotationSpeed: jest.fn(() => mockCharacteristicInstance),
  CoolingThresholdTemperature: jest.fn(() => mockCharacteristicInstance),
  HeatingThresholdTemperature: jest.fn(() => mockCharacteristicInstance),
  Name: jest.fn(() => mockCharacteristicInstance),
  Manufacturer: jest.fn(() => mockCharacteristicInstance),
  Model: jest.fn(() => mockCharacteristicInstance),
  SerialNumber: jest.fn(() => mockCharacteristicInstance),
} as unknown as typeof Characteristic;

// Fix write mock function type
type WriteFunction = {
  (uuid: string): Buffer;
  (uuid: string, buf: Buffer, offset: number): void;
};

const mockWrite: jest.MockedFunction<WriteFunction> = jest.fn((uuid: string, buf?: Buffer, offset?: number) => {
  if (buf === undefined || offset === undefined) {
    return Buffer.from([]);
  }
}) as jest.MockedFunction<WriteFunction>;

// Fix Categories mock: use a specific numeric value
const mockCategories = {
  AIR_CONDITIONER: 22,
} as Record<keyof typeof Categories, number>;

// Define mock logger
const mockLogger: Logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as Logger;

// Cast the mockAPI object to type API, adding a minimal set of properties,
const mockAPI: API = {
  hap: {
    uuid: {
      BASE_UUID: '-0000-1000-8000-0026BB765291',
      generate: jest.fn().mockReturnValue('mock-uuid'),
      isValid: jest.fn().mockReturnValue(true),
      unparse: jest.fn().mockReturnValue('mock-uuid'),
      write: mockWrite,
      toShortForm: jest.fn().mockReturnValue('mock-uuid'),
      toLongForm: jest.fn().mockReturnValue('mock-uuid'),
    },
    Service: mockService,
    Characteristic: mockCharacteristic,
    Categories: mockCategories,
    HAPLibraryVersion: { major: 1, minor: 0 },
    LegacyTypes: {} as typeof LegacyTypes,
    _definitions: {},
    HAPStorage: jest.fn(),
  } as unknown as typeof import('hap-nodejs'),
  on: jest.fn().mockImplementation((event: unknown, callback: unknown) => {
    if (event === 'didFinishLaunching' && typeof callback === 'function') {
      didFinishLaunchingCallback = callback as () => void;
    }
    return mockAPI;
  }),
  platformAccessory: mockPlatformAccessory,
  registerPlatformAccessories: jest.fn(),
  updatePlatformAccessories: jest.fn(),
  unregisterPlatformAccessories: jest.fn(),
  version: 1,
  serverVersion: 'mock-server-version',
  user: {
    configPath: () => '/mock/config/path',
    storagePath: () => '/mock/storage/path',
    prototype: {},
    persistPath: '/mock/persist/path',
    cachedAccessoryPath: () => '/mock/cached/accessory/path',
    setStoragePath: jest.fn(),
  } as unknown as typeof User,
  hapLegacyTypes: LegacyTypes,
  versionGreaterOrEqual: jest.fn().mockReturnValue(true),
  registerAccessory: jest.fn(),
  registerPlatform: jest.fn(),
  publishExternalAccessories: jest.fn(),
} as unknown as API;

jest.mock('homebridge', () => ({
  API: jest.fn(),
  Categories: jest.fn(),
  Characteristic: jest.fn(),
  Logger: jest.fn(),
  PlatformAccessory: jest.fn().mockImplementation((name, uuid) => {
    return {
      context: {},
      UUID: uuid,
      displayName: name,
    };
  }),
  PlatformConfig: jest.fn(),
  Service: jest.fn(),
  User: jest.fn(),
}));

describe('TfiacPlatform', () => {
  let platform: TfiacPlatform;
  let config: PlatformConfig;
  // Store accessory instances for cleanup
  let accessoryInstances: PlatformAccessory[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Use the didFinishLaunchingCallback variable declared at module level
    didFinishLaunchingCallback = () => {};
    
    // Reset logger mocks
    (mockLogger.debug as jest.Mock).mockReset();
    (mockLogger.info as jest.Mock).mockReset();
    (mockLogger.warn as jest.Mock).mockReset();
    (mockLogger.error as jest.Mock).mockReset();
    
    // Clear stored accessory instances
    accessoryInstances = [];
    // Clear TfiacPlatformAccessory instances
    tfiacAccessoryInstances.length = 0;

    // Capture accessory instances for cleanup
    const originalRegisterPlatformAccessories = mockAPI.registerPlatformAccessories;
    (mockAPI.registerPlatformAccessories as jest.Mock).mockImplementation(
      (...args: unknown[]) => {
        if (args.length >= 3 && Array.isArray(args[2])) {
          accessoryInstances.push(...args[2]);
        }
        return originalRegisterPlatformAccessories.apply(mockAPI, args as Parameters<typeof originalRegisterPlatformAccessories>);
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
    };

    // Mock API on method implementation
    (mockAPI.on as jest.MockedFunction<typeof mockAPI.on>).mockImplementation((event: string, callback: () => void) => {
      if (event === 'didFinishLaunching') {
        didFinishLaunchingCallback = callback;
      }
      return mockAPI;
    });

    platform = new TfiacPlatform(mockLogger, config, mockAPI);
    
    // Clear logger mocks for subsequent tests
    (mockLogger.debug as jest.Mock).mockClear();
    (mockLogger.info as jest.Mock).mockClear();
    (mockLogger.warn as jest.Mock).mockClear();
  });

  // Clean up after each test
  afterEach(() => {
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
    
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize correctly', () => {
      expect(mockAPI.on).toHaveBeenCalledWith('didFinishLaunching', expect.any(Function));
    });

    it('should handle empty config', () => {
      const emptyConfig = {
        platform: 'TfiacPlatform',
        name: 'Test Platform',
      };
      
      (mockLogger.info as jest.Mock).mockReset();
      (mockLogger.warn as jest.Mock).mockReset();
      
      platform = new TfiacPlatform(mockLogger, emptyConfig, mockAPI);
      didFinishLaunchingCallback();
      
      expect(mockLogger.info).toHaveBeenCalledWith('No devices to register');
    });
  });

  describe('Device Discovery', () => {
    it('should discover devices from config', () => {
      didFinishLaunchingCallback();

      expect(mockAPI.hap.uuid.generate).toHaveBeenCalled();
      expect(mockPlatformAccessory).toHaveBeenCalled();
      expect(mockAPI.registerPlatformAccessories).toHaveBeenCalled();
    });

    it('should handle empty device config', () => {
      const emptyConfig = { ...config, devices: [] };
      
      (mockLogger.info as jest.Mock).mockReset();
      
      platform = new TfiacPlatform(mockLogger, emptyConfig, mockAPI);
      didFinishLaunchingCallback();
      
      expect(mockLogger.info).toHaveBeenCalledWith('No devices to register');
    });

    it('should handle missing device config', () => {
      const invalidConfig = {
        ...config,
        devices: [{ name: 'Invalid Device' }], // Missing IP address
      };
      
      (mockLogger.error as jest.Mock).mockReset();
      
      platform = new TfiacPlatform(mockLogger, invalidConfig, mockAPI);
      didFinishLaunchingCallback();
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Missing required IP address for device:',
        'Invalid Device',
      );
    });

    it('should add configured accessories when config has valid accessories', () => {
      // Reset mocks to ensure a clean state
      (mockAPI.hap.uuid.generate as jest.Mock).mockClear();
      (mockPlatformAccessory as unknown as jest.Mock).mockClear();
      (mockAPI.registerPlatformAccessories as jest.Mock).mockClear();
      
      // Create a new platform with the valid config
      const validConfig: PlatformConfig = {
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
      };

      platform = new TfiacPlatform(mockLogger, validConfig, mockAPI);
      
      // Trigger the didFinishLaunching callback
      didFinishLaunchingCallback();

      // Verify that the necessary functions were called
      expect(mockAPI.hap.uuid.generate).toHaveBeenCalled();
      expect(mockPlatformAccessory).toHaveBeenCalled();
      expect(mockAPI.registerPlatformAccessories).toHaveBeenCalled();
    });
  });

  describe('Accessory Management', () => {
    it('should configure cached accessories', () => {
      const cachedAccessory = new mockPlatformAccessory('Cached AC', 'cached-uuid');
      platform.configureAccessory(cachedAccessory as PlatformAccessory);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Loading accessory from cache'),
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle device creation errors gracefully', () => {
      ((mockPlatformAccessory as unknown) as jest.MockedFunction<(displayName: string, uuid: string) => PlatformAccessory>).mockImplementationOnce(() => {
        throw new Error('Creation failed');
      });
      
      (mockLogger.error as jest.Mock).mockReset();
      
      platform = new TfiacPlatform(mockLogger, config, mockAPI);
      didFinishLaunchingCallback();
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to initialize device:',
        expect.any(Error),
      );
    });

    it('should handle error during registration', () => {
      const device = { name: 'AC', ip: '1.2.3.4' };
      // const mockCharacteristic = { on: jest.fn().mockReturnThis() }; // Not used directly in this test
      // const mockService = { // Not used directly in this test
      //   setCharacteristic: jest.fn().mockReturnThis(),
      //   getCharacteristic: jest.fn().mockReturnValue(mockCharacteristic),
      // };
      const localMockAPI = {
        ...mockAPI,
        platformAccessory: jest.fn(() => {
          throw new Error('fail');
        }) as unknown as typeof PlatformAccessory,
      };
      platform = new TfiacPlatform(mockLogger, { ...config, devices: [device] }, localMockAPI as API);
      platform.discoverDevices();
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to initialize device:', expect.any(Error));
    });
  });
});

describe('TfiacPlatform (unit, coverage)', () => {
  let platform: TfiacPlatform;
  let mockLogger: Logger;
  let mockAPI: API;
  let config: { platform: string; name: string; devices: unknown[] };

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      success: jest.fn(),
      log: jest.fn(),
    } as unknown as Logger;
    mockAPI = {
      hap: {
        Service: {},
        Characteristic: {},
        uuid: { generate: jest.fn((str: string) => 'uuid-' + str) },
      } as unknown as typeof import('hap-nodejs'),
      on: jest.fn() as jest.Mock,
      platformAccessory: jest.fn((name, uuid) => ({
        UUID: uuid,
        displayName: name,
        context: {},
      })) as unknown as typeof PlatformAccessory,
      updatePlatformAccessories: jest.fn() as jest.Mock,
      registerPlatformAccessories: jest.fn() as jest.Mock,
      version: 1,
      serverVersion: 'mock-server-version',
      user: {
        configPath: () => '/mock/config/path',
        storagePath: () => '/mock/storage/path',
        prototype: {},
        persistPath: '/mock/persist/path',
        cachedAccessoryPath: () => '/mock/cached/accessory/path',
        setStoragePath: jest.fn(),
      } as unknown as typeof User,
      hapLegacyTypes: {},
      versionGreaterOrEqual: jest.fn().mockReturnValue(true),
      registerAccessory: jest.fn(),
      registerPlatform: jest.fn(),
      unregisterPlatformAccessories: jest.fn(),
      publishExternalAccessories: jest.fn(),
    } as unknown as API;
    config = { platform: 'TfiacPlatform', name: 'Test Platform', devices: [] };
  });

  it('should not register accessories if devices is empty', () => {
    platform = new TfiacPlatform(mockLogger, { ...config, devices: [] }, mockAPI);
    platform.discoverDevices();
    expect(mockLogger.info).toHaveBeenCalledWith('No devices to register');
  });

  it('should log error if device is missing IP', () => {
    platform = new TfiacPlatform(mockLogger, { ...config, devices: [{ name: 'NoIP' }] }, mockAPI);
    platform.discoverDevices();
    expect(mockLogger.error).toHaveBeenCalledWith('Missing required IP address for device:', 'NoIP');
  });

  it('should update existing accessory', () => {
    const device = { name: 'AC', ip: '1.2.3.4' };
    const uuid = 'uuid-1.2.3.4AC';
    const mockCharacteristic = { on: jest.fn().mockReturnThis() };
    const mockService = {
      setCharacteristic: jest.fn().mockReturnThis(),
      getCharacteristic: jest.fn().mockReturnValue(mockCharacteristic),
    };
    const existingAccessory = {
      UUID: uuid,
      context: {},
      displayName: '',
      update: jest.fn(),
      getService: jest.fn().mockReturnValue(mockService),
      addService: jest.fn().mockReturnValue(mockService),
    };
    platform = new TfiacPlatform(mockLogger, { ...config, devices: [device] }, mockAPI);
    // @ts-expect-error: test is pushing directly to private array for coverage
    platform.accessories.push(existingAccessory);
    platform.discoverDevices();
    expect(mockLogger.info).toHaveBeenCalledWith('Updated existing accessory: AC');
    expect(mockAPI.updatePlatformAccessories).toHaveBeenCalledWith([existingAccessory]);
  });

  it('should handle error during accessory creation', () => {
    const device = { name: 'AC', ip: '1.2.3.4' };
    const localMockAPI = {
      ...mockAPI,
      platformAccessory: jest.fn(() => {
        throw new Error('fail');
      }) as unknown as typeof PlatformAccessory,
    };
    platform = new TfiacPlatform(mockLogger, { ...config, devices: [device] }, localMockAPI as API);
    platform.discoverDevices();
    expect(mockLogger.error).toHaveBeenCalledWith('Failed to initialize device:', expect.any(Error));
  });

  it('configureAccessory should add accessory to array and log', () => {
    platform = new TfiacPlatform(mockLogger, config, mockAPI);
    const accessory: PlatformAccessory = { displayName: 'Test', UUID: 'uuid' } as PlatformAccessory;
    platform.configureAccessory(accessory);
    // @ts-expect-error: test is accessing private array for coverage
    expect(platform.accessories).toContain(accessory);
    expect(mockLogger.debug).toHaveBeenCalledWith('Loading accessory from cache: Test');
  });
});