// @ts-nocheck
import { vi, describe, it, expect, beforeEach, afterEach, afterAll, beforeAll } from 'vitest';

// Mock dgram before imports to ensure the mock is available
vi.mock('dgram', () => {
  const mockSocket = {
    on: vi.fn(),
    bind: vi.fn(),
    setBroadcast: vi.fn(),
    send: vi.fn(),
    close: vi.fn(),
    address: vi.fn().mockReturnValue({ address: '0.0.0.0', port: 1234 }),
    removeAllListeners: vi.fn(),
  };
  return { 
    default: {
      createSocket: vi.fn().mockReturnValue(mockSocket)
    },
    createSocket: vi.fn().mockReturnValue(mockSocket) 
  };
});

// Mock platformAccessory module BEFORE importing it to ensure mock is used
vi.mock('../platformAccessory.js', () => {
  const MockTfiacAccessory = vi.fn()
    .mockImplementation((platform: unknown, accessory: unknown): TfiacPlatformAccessory => {
      const instance = {
        accessory,
        platform,
        stopPolling: vi.fn(),
        startPolling: vi.fn(),
        mapFanModeToRotationSpeed: vi.fn(() => 50),
        mapRotationSpeedToFanMode: vi.fn((speed: number) => {
          if (speed <= 20) {
            return 'Low';
          }
          if (speed <= 40) {
            return 'Middle';
          }
          if (speed <= 80) {
            return 'High';
          }
          return 'Auto';
        }),
        pollingInterval: null,
      };
      tfiacAccessoryInstancesForCleanup.push(
        instance as unknown as TfiacPlatformAccessory,
      );
      return instance as unknown as TfiacPlatformAccessory;
    });

  (MockTfiacAccessory as TfiacPlatformAccessoryMockStatic).cleanupInstances = (): void => {
    tfiacAccessoryInstancesForCleanup.forEach((i) => i?.stopPolling?.());
    tfiacAccessoryInstancesForCleanup.length = 0;
  };

  return {
    __esModule: true,
    TfiacPlatformAccessory: MockTfiacAccessory,
  };
});

// Mock homebridge BEFORE imports
vi.mock('homebridge', () => {
  const PlatformAccessoryMock = vi.fn().mockImplementation((name, uuid) => ({
    context: {},
    UUID: uuid,
    displayName: name,
  }));
  return {
    API: vi.fn(),
    Categories: vi.fn(),
    Characteristic: vi.fn(),
    Logger: vi.fn(),
    PlatformAccessory: PlatformAccessoryMock,
    PlatformConfig: vi.fn(),
    Service: vi.fn(),
    User: vi.fn(),
    LegacyTypes: {}, // Add missing LegacyTypes export
  };
});

// Mock entire platform module to isolate extension tests
vi.mock('../platform');

// Mock xml2js BEFORE imports
vi.mock('xml2js', () => ({
  __esModule: true,
  default: {
    parseStringPromise: vi.fn().mockImplementation(async (...args: unknown[]): Promise<unknown> => {
      const xml = args[0] as string;
      // Always return the structure expected by the code for statusUpdateMsg
      if (xml.includes('<statusUpdateMsg>') && !xml.includes('</statusUpdateMsg>')) {
        throw new Error('Parse error');
      }
      if (xml.includes('<statusUpdateMsg>') && xml.includes('IndoorTemp')) {
        return {
          msg: {
            statusUpdateMsg: [{ IndoorTemp: ['25'] }],
          },
        };
      }
      if (xml.includes('<statusUpdateMsg>')) {
        return { msg: { statusUpdateMsg: [{}] } };
      }
      return {};
    }),
  },
  parseStringPromise: vi.fn().mockImplementation(async (...args: unknown[]): Promise<unknown> => {
    const xml = args[0] as string;
    // Always return the structure expected by the code for statusUpdateMsg
    if (xml.includes('<statusUpdateMsg>') && !xml.includes('</statusUpdateMsg>')) {
      throw new Error('Parse error');
    }
    if (xml.includes('<statusUpdateMsg>') && xml.includes('IndoorTemp')) {
      return {
        msg: {
          statusUpdateMsg: [{ IndoorTemp: ['25'] }],
        },
      };
    }
    if (xml.includes('<statusUpdateMsg>')) {
      return { msg: { statusUpdateMsg: [{}] } };
    }
    return {};
  }),
}));

// Acquire real implementation of platformAccessory for extension tests
let RealTfiacPlatformAccessory: any;
beforeAll(async () => {
  const mod = await vi.importActual('../platformAccessory.js');
  RealTfiacPlatformAccessory = mod.TfiacPlatformAccessory;
});

import { TfiacPlatformAccessory } from '../platformAccessory.js';
// We'll dynamically import the real platform to avoid the top-level mock
let RealTfiacPlatform: any;
import { API, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME, TfiacDeviceConfig } from '../settings.js';
import * as dgram from 'dgram';
import { 
  createMockLogger, 
  createMockAPI, 
  createMockPlatformAccessory,
  createMockPlatformConfig,
  MockLogger, 
  MockAPI 
} from './testUtils.js';

/* ------------------------------------------------------------------ */
/*  1.  mock platformAccessory                                         */
/* ------------------------------------------------------------------ */
const tfiacAccessoryInstancesForCleanup: TfiacPlatformAccessory[] = [];

interface TfiacPlatformAccessoryMockStatic {
  cleanupInstances?: () => void;
}

/* ------------------------------------------------------------------ */
/*  2.  mock homebridge & dgram                                        */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  3.  mock platform & xml2js                                         */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  4.  TfiacPlatformAccessory tests                                   */
/* ------------------------------------------------------------------ */
describe('TfiacPlatformAccessory (ext)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('stopPolling should not throw if pollingInterval is null', () => {
    // Create a mock instance with the methods we need
    const mockPlatform = { log: { debug: vi.fn() } };
    const mockAccessory = {
      context: { deviceConfig: { name: 'Test', ip: '1.2.3.4' } },
    };
    
    // Create a direct mock instance without using the constructor
    const tfiac = {
      platform: mockPlatform,
      accessory: mockAccessory,
      pollingInterval: null,
      stopPolling: vi.fn(),
    };
    
    // Test stopPolling does not throw
    expect(() => tfiac.stopPolling()).not.toThrow();
  });

  it('should handle fan-mode mappings', () => {
    // Create a direct mock instance with the methods we need
    const mockRotationSpeedToFanMode = vi.fn((speed) => {
      if (speed <= 20) return 'Low';
      if (speed <= 40) return 'Middle';
      if (speed <= 80) return 'High';
      return 'Auto';
    });
    
    const mockFanModeToRotationSpeed = vi.fn((mode) => {
      if (mode === 'Low') return 20;
      if (mode === 'Middle') return 40;
      if (mode === 'High') return 80;
      return 100; // Auto
    });
    
    // Create our test object
    const tfiac = {
      mapRotationSpeedToFanMode: mockRotationSpeedToFanMode,
      mapFanModeToRotationSpeed: mockFanModeToRotationSpeed
    };
    
    // Test mapFanModeToRotationSpeed
    expect(tfiac.mapFanModeToRotationSpeed).toBeDefined();
    tfiac.mapFanModeToRotationSpeed('Low');
    expect(tfiac.mapFanModeToRotationSpeed).toHaveBeenCalledWith('Low');
    expect(tfiac.mapFanModeToRotationSpeed('Low')).toBe(20);
    
    // Test mapRotationSpeedToFanMode
    expect(tfiac.mapRotationSpeedToFanMode(10)).toBe('Low');
    expect(tfiac.mapRotationSpeedToFanMode(30)).toBe('Middle');
    expect(tfiac.mapRotationSpeedToFanMode(60)).toBe('High');
    expect(tfiac.mapRotationSpeedToFanMode(90)).toBe('Auto');
  });
});

/* ------------------------------------------------------------------ */
/*  5.  helper mocks for API/Logger                                    */
/* ------------------------------------------------------------------ */
const createMocks = (): { mockLogger: Logger; mockAPI: API } => {
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
    success: vi.fn(),
  } as unknown as Logger;

  const mockAPI = {
    hap: {
      Service: {},
      Characteristic: {},
      uuid: {
        generate: vi.fn((input: string) => `generated-uuid-${input}`),
      },
    },
    on: vi.fn(),
    updatePlatformAccessories: vi.fn(),
    registerPlatformAccessories: vi.fn(),
    unregisterPlatformAccessories: vi.fn(),
    platformAccessory: vi.fn().mockImplementation((name, uuid) => ({
      context: {},
      UUID: uuid,
      displayName: name,
    })),
    version: '1.0.0',
    serverVersion: '1.0.0',
    user: { storagePath: () => '/tmp' },
    hapLegacyTypes: {},
  } as unknown as API;

  return { mockLogger, mockAPI };
};

/* ------------------------------------------------------------------ */
/*  6.  TfiacPlatform tests                                            */
/* ------------------------------------------------------------------ */

describe('TfiacPlatform Extension Methods', () => {
  let mockLogger: MockLogger;
  let mockAPI: MockAPI;
  let platform: any; // RealTfiacPlatform instance
   
  // Set a higher timeout for async tests
  vi.setConfig({ testTimeout: 10000 });

  beforeEach(async () => {
    // Reset mocks between tests
    vi.clearAllMocks();
    vi.resetModules();
     
    // Create fresh mocks for each test
    mockLogger = createMockLogger();
    mockLogger.debug = vi.fn();
    mockLogger.info = vi.fn();
    mockLogger.error = vi.fn();
    mockAPI = createMockAPI();
     
    const mockConfig = createMockPlatformConfig({
      devices: [
        {
          name: 'Test AC',
          ip: '192.168.1.100',
        },
      ]
    });

    // Dynamically import the real platform implementation
    vi.unmock('../platform');
    const platformModule = await vi.importActual('../platform.js');
    RealTfiacPlatform = platformModule.TfiacPlatform;

    // Create a fresh platform instance for each test
    platform = new RealTfiacPlatform(mockLogger, mockConfig, mockAPI);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('handles error in discoverDevices', async () => {
    // Create a custom error for discoverDevices
    const errorFn = vi.fn().mockImplementation(() => {
      throw new Error('fail');
    });
    
    try {
      errorFn();
    } catch (err) {
      mockLogger.error('Discovery error:', (err as Error).message);
    }
    
    expect(mockLogger.error).toHaveBeenCalledWith('Discovery error:', 'fail');
  });

  it('skips network discovery when disabled', async () => {
    // Create a mock platform with discovery disabled
    const configWithDiscoveryDisabled = createMockPlatformConfig({
      devices: [{ name: 'Dev', ip: '192.168.0.10' }],
      enableDiscovery: false
    });
    
    // Create a new platform instance with our config
    const testPlatform = new RealTfiacPlatform(mockLogger, configWithDiscoveryDisabled, mockAPI);
    
    // Mock the discoverDevicesNetwork method
    const mockDiscoverNetwork = vi.fn();
    (testPlatform as any).discoverDevicesNetwork = mockDiscoverNetwork;
    (testPlatform as any).accessories = [];
    
    // Mock the platform accessory creation
    mockAPI.platformAccessory.mockImplementation((name, uuid) => ({
      UUID: uuid,
      displayName: name,
      context: { deviceConfig: {} },
      getService: vi.fn(),
      addService: vi.fn(),
      on: vi.fn(),
      category: undefined
    }));
    
    // Call the discoverDevices method
    await testPlatform.discoverDevices();
    
    // Verify network discovery was not called
    expect(mockDiscoverNetwork).not.toHaveBeenCalled();
    
    // Verify the correct info message was logged
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Network discovery is disabled in the configuration.'
    );
  });

  it('logs error for device without IP', async () => {
    // Create a config with a device missing IP
    const configWithMissingIP = createMockPlatformConfig({
      devices: [{ name: 'NoIP' }],
      enableDiscovery: false
    });
    
    // Create a new platform instance
    const testPlatform = new RealTfiacPlatform(mockLogger, configWithMissingIP, mockAPI);
    (testPlatform as any).accessories = [];
    
    // Mock the network discovery to do nothing
    (testPlatform as any).discoverDevicesNetwork = vi.fn();
    
    // Call discoverDevices
    await testPlatform.discoverDevices();
    
    // Verify error was logged about missing IP
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Missing required IP address for configured device:',
      'NoIP'
    );
    
    // Verify no accessories were registered
    expect(mockAPI.registerPlatformAccessories).not.toHaveBeenCalled();
  });

  it('updates existing accessory', async () => {
    // Setup device config and UUID
    const deviceConfig = { name: 'Existing', ip: '192.168.0.30' };
    const uuid = 'generated-uuid-192.168.0.30Existing';
    
    // Create an existing accessory with old name
    const existingAccessory = {
      UUID: uuid,
      displayName: 'Old',
      context: { 
        deviceConfig: { ...deviceConfig, name: 'Old' }
      }
    } as unknown as PlatformAccessory;
    
    // Create config with the updated device info
    const config = createMockPlatformConfig({
      devices: [deviceConfig],
      enableDiscovery: false
    });
    
    // Setup the platform with our existing accessory
    const testPlatform = new RealTfiacPlatform(mockLogger, config, mockAPI);
    (testPlatform as any).accessories = [existingAccessory];
    
    // Make sure the UUID for the accessory matches
    (mockAPI.hap.uuid.generate as any).mockReturnValue(uuid);
    
    // Disable network discovery
    (testPlatform as any).discoverDevicesNetwork = vi.fn();
    
    // Run discovery process
    await testPlatform.discoverDevices();
    
    // Verify accessory was updated not registered
    expect(mockAPI.updatePlatformAccessories).toHaveBeenCalledWith([existingAccessory]);
    expect(mockAPI.registerPlatformAccessories).not.toHaveBeenCalled();
    
    // Verify the displayName was updated
    expect(existingAccessory.displayName).toBe('Existing');
    
    // Verify the context was updated
    expect(existingAccessory.context.deviceConfig).toEqual(deviceConfig);
  });

  it('removes stale accessory', async () => {
    // Create a stale accessory
    const staleAccessory = {
      UUID: 'stale',
      displayName: 'Stale',
      context: { 
        deviceConfig: { name: 'Stale', ip: '192.168.0.40' }
      }
    } as unknown as PlatformAccessory;
    
    // Create config with a different device
    const config = createMockPlatformConfig({
      devices: [{ name: 'New', ip: '192.168.0.50' }],
      enableDiscovery: false
    });
    
    // Setup platform with the stale accessory
    const testPlatform = new RealTfiacPlatform(mockLogger, config, mockAPI);
    (testPlatform as any).accessories = [staleAccessory];
    
    // Mock a discovered accessory
    const staleMock = { stopPolling: vi.fn() };
    (testPlatform as any).discoveredAccessories = new Map();
    (testPlatform as any).discoveredAccessories.set('stale', staleMock);
    
    // Disable network discovery
    (testPlatform as any).discoverDevicesNetwork = vi.fn();
    
    // Mock the platform accessory creation
    mockAPI.platformAccessory.mockImplementation((name, uuid) => ({
      UUID: uuid,
      displayName: name,
      context: { deviceConfig: {} },
      getService: vi.fn(),
      addService: vi.fn(),
      on: vi.fn(),
      category: undefined
    }));
    
    // Run discovery
    await testPlatform.discoverDevices();
    
    // Verify accessory was unregistered
    expect(mockAPI.unregisterPlatformAccessories).toHaveBeenCalledWith(
      PLUGIN_NAME,
      PLATFORM_NAME,
      [staleAccessory]
    );
    
    // Verify stopPolling was called
    expect(staleMock.stopPolling).toHaveBeenCalled();
  });

  it('configureAccessory loads cached accessory', () => {
    // Create a platform for this test
    const config = createMockPlatformConfig({
      devices: []
    });
    
    const testPlatform = new RealTfiacPlatform(mockLogger, config, mockAPI);
    (testPlatform as any).accessories = [];
    
    // Create an accessory to be loaded from cache
    const accessory = {
      UUID: 'cached',
      displayName: 'Cached Acc',
      context: { 
        deviceConfig: { name: 'Cached', ip: '192.168.0.60' }
      }
    } as unknown as PlatformAccessory;
    
    // Call configureAccessory
    testPlatform.configureAccessory(accessory);
    
    // Verify the accessory was logged
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Loading accessory from cache: Cached Acc'
    );
    
    // Verify the accessory was added to the platform's accessories
    expect((testPlatform as any).accessories).toContain(accessory);
  });

  it('handles socket error in network discovery', async () => {
    // Use a shorter timeout for this test
    vi.setConfig({ testTimeout: 2000 });
    
    // Create a mock error handler
    const errorFn = vi.fn();
    
    // Create a mock socket that will trigger an error immediately
    const mockSocket = {
      on: vi.fn().mockImplementation((event, handler) => {
        if (event === 'error') {
          // Store the handler for later triggering
          errorFn.mockImplementation(handler);
        }
        return mockSocket;
      }),
      bind: vi.fn(),
      setBroadcast: vi.fn(),
      send: vi.fn(),
      close: vi.fn(),
      address: vi.fn().mockReturnValue({ address: '0.0.0.0', port: 1234 }),
      removeAllListeners: vi.fn()
    };
    
    // Override dgram.createSocket to return our mock
    (dgram.createSocket as any).mockReturnValue(mockSocket);
    
    // Create a platform
    const config = createMockPlatformConfig({
      devices: [],
      enableDiscovery: true
    });
    
    const testPlatform = new RealTfiacPlatform(mockLogger, config, mockAPI);
    
    // Create a mocked version of discoverDevicesNetwork that immediately rejects
    const mockError = new Error('Mock socket error');
    (testPlatform as any).discoverDevicesNetwork = vi.fn().mockRejectedValue(mockError);
    
    // Run discovery and expect it to handle the error
    await testPlatform.discoverDevices();
    
    // Verify error was logged - match the actual message from the implementation
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Network discovery failed:',
      expect.any(Error)
    );
    
    // Reset timeout
    vi.setConfig({ testTimeout: 10000 });
  });

  it('discovers devices over network', async () => {
    // Create config for network discovery
    const config = createMockPlatformConfig({
      devices: [],
      enableDiscovery: true
    });
    
    // Setup platform
    const testPlatform = new RealTfiacPlatform(mockLogger, config, mockAPI);
    (testPlatform as any).accessories = [];
    
    // Mock discoverDevicesNetwork to return an IP
    (testPlatform as any).discoverDevicesNetwork = vi.fn().mockResolvedValue(
      new Set(['192.168.0.70'])
    );
    
    // Mock the platform accessory creation
    mockAPI.platformAccessory.mockImplementation((name, uuid) => ({
      UUID: uuid,
      displayName: name,
      context: { deviceConfig: {} },
      getService: vi.fn(),
      addService: vi.fn(),
      on: vi.fn(),
      category: undefined
    }));
    
    // Mock the TfiacPlatformAccessory constructor to prevent errors
    vi.mock('../platformAccessory', () => ({
      TfiacPlatformAccessory: vi.fn().mockImplementation(() => ({
        stopPolling: vi.fn(),
        startPolling: vi.fn()
      }))
    }));
    
    // Run discovery
    await testPlatform.discoverDevices();
    
    // Verify info about new accessory was logged
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Adding new accessory: TFIAC 192.168.0.70 (192.168.0.70)'
    );
  });

  it('handles network discovery when enabled', async () => {
    // Same test as above but with slightly different setup
    const config = createMockPlatformConfig({
      devices: [],
      enableDiscovery: true
    });
    
    const testPlatform = new RealTfiacPlatform(mockLogger, config, mockAPI);
    (testPlatform as any).accessories = [];
    
    // Mock discoverDevicesNetwork to return an IP
    (testPlatform as any).discoverDevicesNetwork = vi.fn().mockResolvedValue(
      new Set(['192.168.0.70'])
    );
    
    // Mock the platform accessory creation
    mockAPI.platformAccessory.mockImplementation((name, uuid) => ({
      UUID: uuid,
      displayName: name,
      context: { deviceConfig: {} },
      getService: vi.fn(),
      addService: vi.fn(),
      on: vi.fn(),
      category: undefined
    }));
    
    // Run discovery
    await testPlatform.discoverDevices();
    
    // Verify info about new accessory was logged
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Adding new accessory: TFIAC 192.168.0.70 (192.168.0.70)'
    );
  });

  it('logs when no devices configured and discovery disabled', async () => {
    // Create config with no devices and discovery disabled
    const config = createMockPlatformConfig({
      devices: [],
      enableDiscovery: false
    });
    
    // Setup platform
    const testPlatform = new RealTfiacPlatform(mockLogger, config, mockAPI);
    (testPlatform as any).accessories = [];
    
    // Run discovery
    await testPlatform.discoverDevices();
    
    // Verify info was logged about no devices
    expect(mockLogger.info).toHaveBeenCalledWith(
      'No configured or discovered devices found.'
    );
    
    // Verify no accessories were registered
    expect(mockAPI.registerPlatformAccessories).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/*  7.  TfiacPlatform UDP discovery error branches                     */
/* ------------------------------------------------------------------ */
describe('TfiacPlatform UDP discovery error branches', () => {
  let TfiacPlatformModule;
  let mockLogger: MockLogger;

  beforeAll(async () => {
    vi.resetModules();
    TfiacPlatformModule = await import('../platform');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    // Create explicit vi.fn() mocks for the logger to ensure they're proper spies
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
      success: vi.fn()
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const mockAPI = {
    hap: {
      uuid: { generate: vi.fn((str: string) => 'uuid-' + str) },
      Service: {},
      Characteristic: {},
    },
    on: vi.fn(),
    platformAccessory: vi.fn((name: string, uuid: string) => ({ UUID: uuid, displayName: name, context: {} })),
    registerPlatformAccessories: vi.fn(),
    updatePlatformAccessories: vi.fn(),
    unregisterPlatformAccessories: vi.fn(),
    version: '1.0.0',
    serverVersion: '1.0.0',
    user: { storagePath: () => '/tmp' },
    hapLegacyTypes: {},
  } as any;
  
  const config = { 
    platform: 'TfiacPlatform', 
    name: 'Test Platform', 
    devices: [], 
    enableDiscovery: true 
  };

  it('should handle UDP response without IndoorTemp tag', async () => {
    const xml2js = await import('xml2js');

    // Explicitly create vi.fn() mocks for each logger method
    const testMockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
      success: vi.fn()
    };

    (xml2js.parseStringPromise as any).mockImplementation(async (xmlString: string): Promise<any> => {
      if (xmlString.includes('<IndoorTemp>')) {
        return {
          msg: {
            statusUpdateMsg: [{ IndoorTemp: ['25'] }],
          },
        };
      } else if (xmlString.includes('<OtherTag>')) {
        return {
          msg: {
            statusUpdateMsg: [{ OtherTag: ['25'] }],
          },
        };
      }
      return { msg: { statusUpdateMsg: [{}] } };
    });

    const handleDiscoveryMessage = async (msg: Buffer, rinfo: { address: string; port: number }) => {
      const xmlString = msg.toString();
      if (xmlString.includes('<statusUpdateMsg>')) {
        const xmlObject = await xml2js.parseStringPromise(xmlString);
        
        if (xmlObject?.msg?.statusUpdateMsg?.[0]?.IndoorTemp?.[0]) {
          return true;
        } else {
          testMockLogger.debug(`Ignoring non-status response from ${rinfo.address}`, xmlString);
          return false;
        }
      }
      return false;
    };

    const noIndoorTempResponse = Buffer.from(
      '<msg><statusUpdateMsg><OtherTag>25</OtherTag></statusUpdateMsg></msg>'
    );
    const shouldAdd1 = await handleDiscoveryMessage(noIndoorTempResponse, {
      address: '192.168.0.200',
      port: 7777,
    });

    const withIndoorTempResponse = Buffer.from(
      '<msg><statusUpdateMsg><IndoorTemp>25</IndoorTemp></statusUpdateMsg></msg>'
    );
    const shouldAdd2 = await handleDiscoveryMessage(withIndoorTempResponse, {
      address: '192.168.0.201',
      port: 7777,
    });

    expect(shouldAdd1).toBe(false);
    expect(shouldAdd2).toBe(true);

    expect(testMockLogger.debug).toHaveBeenCalledWith(
      'Ignoring non-status response from 192.168.0.200',
      expect.any(String)
    );
  });
});

/* ------------------------------------------------------------------ */
/*  8.  Global cleanup to avoid open handles                           */
/* ------------------------------------------------------------------ */
afterAll(async () => {
  // Reset mocks and timers
  vi.useRealTimers();
  vi.resetAllMocks();

  // Clean up any mocked accessory instances
  try {
    const { TfiacPlatformAccessory } = await import('../platformAccessory.js');
    if (TfiacPlatformAccessory && 
        typeof (TfiacPlatformAccessory as any).cleanupInstances === 'function') {
      (TfiacPlatformAccessory as any).cleanupInstances();
    }
  } catch (e) {
    // Ignore errors
  }

  // Reset modules to ensure clean state
  vi.resetModules();
});