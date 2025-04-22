// filepath: /Users/denisletnikov/Code/homebridge-tfiac/src/__tests__/platform.branch.test.ts
import { API, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import { TfiacPlatform } from '../platform';
import { PLUGIN_NAME, PLATFORM_NAME, TfiacPlatformConfig } from '../settings';
import { TfiacPlatformAccessory } from '../platformAccessory';

// Create mocks
jest.mock('../platformAccessory');

describe('TfiacPlatform branch coverage tests', () => {
  let platform: TfiacPlatform;
  let mockLog: jest.Mocked<Logger>;
  let mockApi: jest.Mocked<API>;
  let mockConfig: TfiacPlatformConfig;
  let mockAccessory: PlatformAccessory;
  let didFinishLaunchingCallback: () => void;

  beforeEach(() => {
    // Reset mocks for each test
    jest.clearAllMocks();
    
    // Mock Logger
    mockLog = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as jest.Mocked<Logger>;
    
    // Mock API
    mockApi = {
      hap: {
        Service: jest.fn() as any,
        Characteristic: jest.fn() as any,
        uuid: {
          generate: jest.fn((id) => `test-uuid-${id}`),
        },
      },
      on: jest.fn((event, callback) => {
        if (event === 'didFinishLaunching') {
          didFinishLaunchingCallback = callback;
        }
      }),
      registerPlatformAccessories: jest.fn(),
      unregisterPlatformAccessories: jest.fn(),
      platformAccessory: jest.fn(() => mockAccessory),
    } as unknown as jest.Mocked<API>;
    
    // Mock Accessory
    mockAccessory = {
      UUID: 'test-uuid',
      displayName: 'Test Accessory',
      context: {},
      getService: jest.fn(),
      removeService: jest.fn(),
    } as unknown as PlatformAccessory;
    
    // Default config
    mockConfig = {
      platform: PLATFORM_NAME,
      name: 'Test Platform',
      devices: [],
      enableDiscovery: false,
    };
    
    // Create platform instance
    platform = new TfiacPlatform(mockLog, mockConfig, mockApi);
    
    // Mock methods that need to be spied on
    jest.spyOn(platform, 'discoverDevices').mockImplementation(async () => {});
  });

  describe('discoverDevices method', () => {
    test('should handle empty devices array with discovery disabled', async () => {
      // Use internal instance directly to test branch
      const platformAny = platform as any;
      
      // Override mock implementation for this test
      platformAny.discoverDevices = jest.requireActual('../platform').TfiacPlatform.prototype.discoverDevices;
      
      // Setup test conditions
      platformAny.config = { 
        devices: [],
        enableDiscovery: false
      };
      platformAny.accessories = [];
      
      // Call method
      await platformAny.discoverDevices();
      
      // Check branch execution
      expect(mockLog.info).toHaveBeenCalledWith('No configured or discovered devices found.');
      expect(mockLog.info).not.toHaveBeenCalledWith(expect.stringContaining('Removing'));
    });
    
    test('should remove stale accessories when no devices found and accessories exist', async () => {
      // Use internal instance directly to test branch
      const platformAny = platform as any;
      
      // Override mock implementation for this test
      platformAny.discoverDevices = jest.requireActual('../platform').TfiacPlatform.prototype.discoverDevices;
      
      // Setup test conditions
      platformAny.config = { 
        devices: [],
        enableDiscovery: false
      };
      platformAny.accessories = [mockAccessory];
      
      // Call method
      await platformAny.discoverDevices();
      
      // Check branch execution
      expect(mockLog.info).toHaveBeenCalledWith('No configured or discovered devices found.');
      expect(mockLog.info).toHaveBeenCalledWith('Removing 1 stale accessories.');
      expect(mockApi.unregisterPlatformAccessories).toHaveBeenCalledWith(
        PLUGIN_NAME,
        PLATFORM_NAME,
        [mockAccessory]
      );
      expect(platformAny.accessories.length).toBe(0);
    });
    
    test('should skip devices without IP addresses', async () => {
      // Use internal instance directly to test branch
      const platformAny = platform as any;
      
      // Override mock implementation for this test
      platformAny.discoverDevices = jest.requireActual('../platform').TfiacPlatform.prototype.discoverDevices;
      
      // Setup test conditions
      platformAny.config = {
        devices: [
          { name: 'Invalid Device' } // Missing IP
        ],
        enableDiscovery: false
      };
      platformAny.accessories = [];
      platformAny.discoveredAccessories = new Map();
      
      // Call method
      await platformAny.discoverDevices();
      
      // Check branch execution
      expect(mockLog.error).toHaveBeenCalledWith(
        'Missing required IP address for configured device:',
        'Invalid Device'
      );
    });
    
    test('should handle duplicate IP addresses', async () => {
      // Use internal instance directly to test branch
      const platformAny = platform as any;
      
      // Override mock implementation for this test
      platformAny.discoverDevices = jest.requireActual('../platform').TfiacPlatform.prototype.discoverDevices;
      
      // Setup test conditions
      platformAny.config = {
        devices: [
          { name: 'Device 1', ip: '192.168.1.1' },
          { name: 'Device 2', ip: '192.168.1.1' } // Duplicate IP
        ],
        enableDiscovery: false
      };
      platformAny.accessories = [];
      platformAny.discoveredAccessories = new Map();
      
      // Ensure that platformAny.api has the correct structure with hap.uuid.generate
      platformAny.api = {
        ...mockApi,
        hap: {
          ...mockApi.hap,
          uuid: {
            generate: jest.fn((id) => `test-uuid-${id}`),
          },
          Service: mockApi.hap.Service,
          Characteristic: mockApi.hap.Characteristic,
        },
      };
      
      // Mock TfiacPlatformAccessory constructor to throw for duplicate IPs
      (TfiacPlatformAccessory as jest.Mock).mockImplementation((platform, accessory, device) => {
        if (device.ip === '192.168.1.1' && device.name === 'Device 2') {
          throw new Error('Duplicate IP address detected: 192.168.1.1');
        }
        return {
          accessory,
          device,
        };
      });
      
      // Call method
      await platformAny.discoverDevices();
      
      // Check branch execution
      expect(mockLog.error).toHaveBeenCalledWith(
        'Failed to initialize device:',
        expect.objectContaining({
          message: expect.stringContaining('Duplicate IP address detected: 192.168.1.1')
        })
      );
    });
  });

  test('should trigger discoverDevices when didFinishLaunching event occurs', () => {
    // Call the callback
    didFinishLaunchingCallback();
    
    // Check if discoverDevices was called
    expect(platform.discoverDevices).toHaveBeenCalled();
  });
  
  test('should configure an accessory when configureAccessory is called', () => {
    // Use internal instance directly to test branch
    const platformAny = platform as any;
    
    // Setup test conditions
    platformAny.accessories = [];
    
    // Call method
    platform.configureAccessory(mockAccessory);
    
    // Check effects
    expect(mockAccessory.category).toBe(21); // AIR_CONDITIONER
    expect(platformAny.accessories).toContain(mockAccessory);
  });
});
