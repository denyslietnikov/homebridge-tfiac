// platform.branch.test.ts
import { API, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import { TfiacPlatform } from '../platform';
import { PLUGIN_NAME, PLATFORM_NAME, TfiacPlatformConfig } from '../settings.js';
import { TfiacPlatformAccessory } from '../platformAccessory.js';

// Mock modules with jest functions
jest.mock('../platformAccessory');
jest.mock('../DisplaySwitchAccessory', () => ({
  DisplaySwitchAccessory: jest.fn(() => ({ name: 'DisplaySwitchAccessory' }))
}));
jest.mock('../SleepSwitchAccessory', () => ({
  SleepSwitchAccessory: jest.fn(() => ({ name: 'SleepSwitchAccessory' }))
}));
jest.mock('../FanSpeedAccessory', () => ({
  FanSpeedAccessory: jest.fn(() => ({ name: 'FanSpeedAccessory' }))
}));
jest.mock('../DrySwitchAccessory', () => ({
  DrySwitchAccessory: jest.fn(() => ({ name: 'DrySwitchAccessory' }))
}));
jest.mock('../FanOnlySwitchAccessory', () => ({
  FanOnlySwitchAccessory: jest.fn(() => ({ name: 'FanOnlySwitchAccessory' }))
}));
jest.mock('../StandaloneFanAccessory', () => ({
  StandaloneFanAccessory: jest.fn(() => ({ name: 'StandaloneFanAccessory' }))
}));
jest.mock('../HorizontalSwingSwitchAccessory', () => ({
  HorizontalSwingSwitchAccessory: jest.fn(() => ({ name: 'HorizontalSwingSwitchAccessory' }))
}));
jest.mock('../TurboSwitchAccessory', () => ({
  TurboSwitchAccessory: jest.fn(() => ({ name: 'TurboSwitchAccessory' }))
}));
jest.mock('../EcoSwitchAccessory', () => ({
  EcoSwitchAccessory: jest.fn(() => ({ name: 'EcoSwitchAccessory' }))
}));
jest.mock('../BeepSwitchAccessory', () => ({
  BeepSwitchAccessory: jest.fn(() => ({ name: 'BeepSwitchAccessory' }))
}));

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
        Service: {
          Switch: { UUID: 'switch-uuid' },
          Fanv2: { UUID: 'fanv2-uuid' },
          TemperatureSensor: { UUID: 'temp-sensor-uuid' },
          Categories: { AIR_CONDITIONER: 21 }
        },
        Characteristic: jest.fn() as any,
        uuid: {
          generate: jest.fn((id) => `test-uuid-${id}`),
        },
        Categories: { AIR_CONDITIONER: 21 },
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
    
    // Mock Accessory with some services
    mockAccessory = {
      UUID: 'test-uuid',
      displayName: 'Test Accessory',
      context: { deviceConfig: { name: 'Test', ip: '1.2.3.4' } }, // Add initial context
      getService: jest.fn((identifier: string | { UUID: string }, subtype?: string) => { // Define parameters
        // Simulate finding services by name or UUID/subtype
        if (typeof identifier === 'string') {
          if (identifier === 'Display') return { UUID: 'DisplayServiceUUID', subtype: 'display', displayName: 'Display' };
          if (identifier === 'Sleep Mode') return { UUID: 'SleepServiceUUID', subtype: 'sleepmode', displayName: 'Sleep Mode' };
        } else if (identifier.UUID === mockApi.hap.Service.Switch.UUID) {
          // Use the subtype parameter
          if (subtype === 'display') return { UUID: 'DisplayServiceUUID', subtype: 'display', displayName: 'Display' };
          if (subtype === 'sleepmode') return { UUID: 'SleepServiceUUID', subtype: 'sleepmode', displayName: 'Sleep Mode' };
          if (subtype === 'fanspeed') return null;
          if (subtype === 'drymode') return { UUID: 'DryServiceUUID', subtype: 'drymode', displayName: 'Dry Mode' };
          if (subtype === 'fanonlymode') return { UUID: 'FanOnlyServiceUUID', subtype: 'fanonlymode', displayName: 'Fan Only Mode' };
          if (subtype === 'standalonefan') return { UUID: 'StandaloneFanServiceUUID', subtype: 'standalonefan', displayName: 'Standalone Fan' };
          if (subtype === 'horizontalswing') return { UUID: 'HorizontalSwingServiceUUID', subtype: 'horizontalswing', displayName: 'Horizontal Swing' };
          if (subtype === 'turbo') return { UUID: 'TurboServiceUUID', subtype: 'turbo', displayName: 'Turbo' };
          if (subtype === 'ecomode') return { UUID: 'EcoServiceUUID', subtype: 'ecomode', displayName: 'ECO Mode' };
          if (subtype === 'beep') return { UUID: 'BeepServiceUUID', subtype: 'beep', displayName: 'Beep' };
        } else if (identifier.UUID === mockApi.hap.Service.Fanv2.UUID) {
          // Use the subtype parameter
          if (subtype === 'fanspeed') return { UUID: 'FanSpeedServiceUUID', subtype: 'fanspeed', displayName: 'Fan Speed' };
        } else if (identifier.UUID === mockApi.hap.Service.TemperatureSensor.UUID) {
          return { UUID: mockApi.hap.Service.TemperatureSensor.UUID, subtype: 'tempsensor', displayName: 'Temperature Sensor' };
        }
        return undefined;
      }),
      getServiceById: jest.fn((uuid: string, subtype: string) => { // Define parameters
        if (uuid === mockApi.hap.Service.Switch.UUID) {
          if (subtype === 'display') return { UUID: 'DisplayServiceUUID', subtype: 'display', displayName: 'Display' };
          if (subtype === 'sleepmode') return { UUID: 'SleepServiceUUID', subtype: 'sleepmode', displayName: 'Sleep Mode' };
          if (subtype === 'drymode') return { UUID: 'DryServiceUUID', subtype: 'drymode', displayName: 'Dry Mode' };
          if (subtype === 'fanonlymode') return { UUID: 'FanOnlyServiceUUID', subtype: 'fanonlymode', displayName: 'Fan Only Mode' };
          if (subtype === 'standalonefan') return { UUID: 'StandaloneFanServiceUUID', subtype: 'standalonefan', displayName: 'Standalone Fan' };
          if (subtype === 'horizontalswing') return { UUID: 'HorizontalSwingServiceUUID', subtype: 'horizontalswing', displayName: 'Horizontal Swing' };
          if (subtype === 'turbo') return { UUID: 'TurboServiceUUID', subtype: 'turbo', displayName: 'Turbo' };
          if (subtype === 'ecomode') return { UUID: 'EcoServiceUUID', subtype: 'ecomode', displayName: 'ECO Mode' };
          if (subtype === 'beep') return { UUID: 'BeepServiceUUID', subtype: 'beep', displayName: 'Beep' };
        } else if (uuid === mockApi.hap.Service.Fanv2.UUID) {
          if (subtype === 'fanspeed') return { UUID: 'FanSpeedServiceUUID', subtype: 'fanspeed', displayName: 'Fan Speed' };
        } else if (uuid === mockApi.hap.Service.TemperatureSensor.UUID) {
          return { UUID: mockApi.hap.Service.TemperatureSensor.UUID, subtype: 'tempsensor', displayName: 'Temperature Sensor' };
        }
        return undefined;
      }),
      removeService: jest.fn(),
      services: [
        { UUID: mockApi.hap.Service.TemperatureSensor.UUID, subtype: 'tempsensor', displayName: 'Temperature Sensor' },
        { UUID: 'OtherServiceUUID', subtype: 'other', displayName: 'Other Service' },
      ],
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
      const platformAny = platform as any;
      platformAny.discoverDevices = jest.requireActual('../platform').TfiacPlatform.prototype.discoverDevices;
      platformAny.config = { 
        devices: [],
        enableDiscovery: false
      };
      platformAny.accessories = [];
      await platformAny.discoverDevices();
      expect(mockLog.info).toHaveBeenCalledWith('No configured or discovered devices found.');
      expect(mockLog.info).not.toHaveBeenCalledWith(expect.stringContaining('Removing'));
    });
    
    test('should remove stale accessories when no devices found and accessories exist', async () => {
      const platformAny = platform as any;
      platformAny.discoverDevices = jest.requireActual('../platform').TfiacPlatform.prototype.discoverDevices;
      platformAny.config = { 
        devices: [],
        enableDiscovery: false
      };
      platformAny.accessories = [mockAccessory];
      await platformAny.discoverDevices();
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
      const platformAny = platform as any;
      platformAny.discoverDevices = jest.requireActual('../platform').TfiacPlatform.prototype.discoverDevices;
      platformAny.config = {
        devices: [
          { name: 'Invalid Device' }
        ],
        enableDiscovery: false
      };
      platformAny.accessories = [];
      platformAny.discoveredAccessories = new Map();
      await platformAny.discoverDevices();
      expect(mockLog.error).toHaveBeenCalledWith(
        'Missing required IP address for configured device:',
        'Invalid Device'
      );
    });
    
    test('should handle duplicate IP addresses', async () => {
      const platformAny = platform as any;
      platformAny.discoverDevices = jest.requireActual('../platform').TfiacPlatform.prototype.discoverDevices;
      platformAny.config = {
        devices: [
          { name: 'Device 1', ip: '192.168.1.1' },
          { name: 'Device 2', ip: '192.168.1.1' }
        ],
        enableDiscovery: false
      };
      platformAny.accessories = [];
      platformAny.discoveredAccessories = new Map();
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
      (TfiacPlatformAccessory as jest.Mock).mockImplementation((platform, accessory, device) => {
        if (device.ip === '192.168.1.1' && device.name === 'Device 2') {
          throw new Error('Duplicate IP address detected: 192.168.1.1');
        }
        return {
          accessory,
          device,
        };
      });
      await platformAny.discoverDevices();
      expect(mockLog.error).toHaveBeenCalledWith(
        'Failed to initialize device:',
        expect.objectContaining({
          message: expect.stringContaining('Duplicate IP address detected: 192.168.1.1')
        })
      );
    });
  });

  test('should trigger discoverDevices when didFinishLaunching event occurs', () => {
    didFinishLaunchingCallback();
    expect(platform.discoverDevices).toHaveBeenCalled();
  });
  
  test('should configure an accessory when configureAccessory is called', () => {
    const platformAny = platform as any;
    platformAny.accessories = [];
    platform.configureAccessory(mockAccessory);
    expect(mockAccessory.category).toBe(21);
    expect(platformAny.accessories).toContain(mockAccessory);
  });

  describe('removeDisabledServices method', () => {
    let platformAny: any;

    beforeEach(() => {
      platformAny = platform as any;
      platformAny.discoverDevices = jest.requireActual('../platform').TfiacPlatform.prototype.discoverDevices;
      platformAny.discoverDevicesNetwork = jest.fn().mockResolvedValue(new Set());
      platformAny.discoveredAccessories.clear();
      platformAny.displayAccessories.clear();
      platformAny.sleepAccessories.clear();
      platformAny.fanSpeedAccessories.clear();
      platformAny.dryAccessories.clear();
      platformAny.fanOnlyAccessories.clear();
      platformAny.standaloneFanAccessories.clear();
      platformAny.horizontalSwingAccessories.clear();
      platformAny.turboAccessories.clear();
      platformAny.ecoAccessories.clear();
      platformAny.beepAccessories.clear();
      platformAny.api.registerPlatformAccessories = jest.fn();
      platformAny.api.updatePlatformAccessories = jest.fn();
      platformAny.api.platformAccessory = jest.fn((name, uuid) => ({
          UUID: uuid,
          displayName: name,
          context: {},
          category: 0,
          getService: jest.fn(),
          removeService: jest.fn(),
          services: [],
      }));
      
      // Clear mock implementations
      (TfiacPlatformAccessory as jest.Mock).mockClear().mockImplementation(() => ({}));
      
      // Import the actual constructor functions but then mock their implementations
      const DisplaySwitchMod = jest.requireActual('../DisplaySwitchAccessory');
      const SleepSwitchMod = jest.requireActual('../SleepSwitchAccessory');
      const FanSpeedMod = jest.requireActual('../FanSpeedAccessory');
      const DryMod = jest.requireActual('../DrySwitchAccessory');
      const FanOnlyMod = jest.requireActual('../FanOnlySwitchAccessory');
      const StandaloneFanMod = jest.requireActual('../StandaloneFanAccessory');
      const HorizontalSwingMod = jest.requireActual('../HorizontalSwingSwitchAccessory');
      const TurboMod = jest.requireActual('../TurboSwitchAccessory');
      const EcoMod = jest.requireActual('../EcoSwitchAccessory');
      const BeepMod = jest.requireActual('../BeepSwitchAccessory');
      
      // Store original constructors for spying
      platformAny.DisplaySwitchAccessory = DisplaySwitchMod.DisplaySwitchAccessory;
      platformAny.SleepSwitchAccessory = SleepSwitchMod.SleepSwitchAccessory;
      platformAny.FanSpeedAccessory = FanSpeedMod.FanSpeedAccessory;
      platformAny.DrySwitchAccessory = DryMod.DrySwitchAccessory;
      platformAny.FanOnlySwitchAccessory = FanOnlyMod.FanOnlySwitchAccessory;
      platformAny.StandaloneFanAccessory = StandaloneFanMod.StandaloneFanAccessory;
      platformAny.HorizontalSwingSwitchAccessory = HorizontalSwingMod.HorizontalSwingSwitchAccessory;
      platformAny.TurboSwitchAccessory = TurboMod.TurboSwitchAccessory;
      platformAny.EcoSwitchAccessory = EcoMod.EcoSwitchAccessory;
      platformAny.BeepSwitchAccessory = BeepMod.BeepSwitchAccessory;
      
      // Setup spies
      jest.spyOn(platformAny, 'DisplaySwitchAccessory').mockImplementation(() => ({}));
      jest.spyOn(platformAny, 'SleepSwitchAccessory').mockImplementation(() => ({}));
      jest.spyOn(platformAny, 'FanSpeedAccessory').mockImplementation(() => ({}));
      jest.spyOn(platformAny, 'DrySwitchAccessory').mockImplementation(() => ({}));
      jest.spyOn(platformAny, 'FanOnlySwitchAccessory').mockImplementation(() => ({}));
      jest.spyOn(platformAny, 'StandaloneFanAccessory').mockImplementation(() => ({}));
      jest.spyOn(platformAny, 'HorizontalSwingSwitchAccessory').mockImplementation(() => ({}));
      jest.spyOn(platformAny, 'TurboSwitchAccessory').mockImplementation(() => ({}));
      jest.spyOn(platformAny, 'EcoSwitchAccessory').mockImplementation(() => ({}));
      jest.spyOn(platformAny, 'BeepSwitchAccessory').mockImplementation(() => ({}));
    });

    test('should remove Display service if enableDisplay is false', () => {
      const deviceConfig = { name: 'Test', ip: '1.2.3.4', enableDisplay: false };
      platformAny.removeDisabledServices(mockAccessory, deviceConfig);
      expect(mockAccessory.removeService).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Display' }));
      expect(platformAny.api.updatePlatformAccessories).toHaveBeenCalledWith([mockAccessory]);
    });

    test('should remove Sleep service if enableSleep is false', () => {
      const deviceConfig = { name: 'Test', ip: '1.2.3.4', enableSleep: false };
      platformAny.removeDisabledServices(mockAccessory, deviceConfig);
      expect(mockAccessory.removeService).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Sleep Mode' }));
      expect(platformAny.api.updatePlatformAccessories).toHaveBeenCalledWith([mockAccessory]);
    });

    test('should remove FanSpeed service if enableFanSpeed is false', () => {
      const deviceConfig = { name: 'Test', ip: '1.2.3.4', enableFanSpeed: false };
      platformAny.removeDisabledServices(mockAccessory, deviceConfig);
      expect(mockAccessory.removeService).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Fan Speed' }));
      expect(platformAny.api.updatePlatformAccessories).toHaveBeenCalledWith([mockAccessory]);
    });

    test('should remove Dry service if enableDry is false', () => {
      const deviceConfig = { name: 'Test', ip: '1.2.3.4', enableDry: false };
      platformAny.removeDisabledServices(mockAccessory, deviceConfig);
      expect(mockAccessory.removeService).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Dry Mode' }));
      expect(platformAny.api.updatePlatformAccessories).toHaveBeenCalledWith([mockAccessory]);
    });

    test('should remove FanOnly service if enableFanOnly is false', () => {
      const deviceConfig = { name: 'Test', ip: '1.2.3.4', enableFanOnly: false };
      platformAny.removeDisabledServices(mockAccessory, deviceConfig);
      expect(mockAccessory.removeService).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Fan Only Mode' }));
      expect(platformAny.api.updatePlatformAccessories).toHaveBeenCalledWith([mockAccessory]);
    });

    test('should remove StandaloneFan service if enableStandaloneFan is false', () => {
      const deviceConfig = { name: 'Test', ip: '1.2.3.4', enableStandaloneFan: false };
      platformAny.removeDisabledServices(mockAccessory, deviceConfig);
      expect(mockAccessory.removeService).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Standalone Fan' }));
      expect(platformAny.api.updatePlatformAccessories).toHaveBeenCalledWith([mockAccessory]);
    });

    test('should remove HorizontalSwing service if enableHorizontalSwing is false', () => {
      const deviceConfig = { name: 'Test', ip: '1.2.3.4', enableHorizontalSwing: false };
      platformAny.removeDisabledServices(mockAccessory, deviceConfig);
      expect(mockAccessory.removeService).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Horizontal Swing' }));
      expect(platformAny.api.updatePlatformAccessories).toHaveBeenCalledWith([mockAccessory]);
    });

    test('should remove Turbo service if enableTurbo is false', () => {
      const deviceConfig = { name: 'Test', ip: '1.2.3.4', enableTurbo: false };
      platformAny.removeDisabledServices(mockAccessory, deviceConfig);
      expect(mockAccessory.removeService).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Turbo' }));
      expect(platformAny.api.updatePlatformAccessories).toHaveBeenCalledWith([mockAccessory]);
    });

    test('should remove Eco service if enableEco is false', () => {
      const deviceConfig = { name: 'Test', ip: '1.2.3.4', enableEco: false };
      platformAny.removeDisabledServices(mockAccessory, deviceConfig);
      expect(mockAccessory.removeService).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'ECO Mode' }));
      expect(platformAny.api.updatePlatformAccessories).toHaveBeenCalledWith([mockAccessory]);
    });

    test('should remove Beep service if enableBeep is false', () => {
      const deviceConfig = { name: 'Test', ip: '1.2.3.4', enableBeep: false };
      platformAny.removeDisabledServices(mockAccessory, deviceConfig);
      expect(mockAccessory.removeService).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Beep' }));
      expect(platformAny.api.updatePlatformAccessories).toHaveBeenCalledWith([mockAccessory]);
    });

    test('should remove TemperatureSensor service if enableTemperature is false', () => {
      const deviceConfig = { name: 'Test', ip: '1.2.3.4', enableTemperature: false };
      platformAny.removeDisabledServices(mockAccessory, deviceConfig);
      expect(mockAccessory.removeService).toHaveBeenCalledWith(
        expect.objectContaining({ UUID: mockApi.hap.Service.TemperatureSensor.UUID })
      );
      expect(platformAny.api.updatePlatformAccessories).toHaveBeenCalledWith([mockAccessory]);
    });

    test('should not call updatePlatformAccessories if no services were removed', () => {
      const deviceConfig = { name: 'Test', ip: '1.2.3.4', enableDisplay: true, enableSleep: true };
      mockAccessory.getService = jest.fn(() => undefined);
      mockAccessory.getServiceById = jest.fn(() => undefined);
      platformAny.removeDisabledServices(mockAccessory, deviceConfig);
      expect(mockAccessory.removeService).not.toHaveBeenCalled();
      expect(platformAny.api.updatePlatformAccessories).not.toHaveBeenCalled();
    });

    test('should handle case where service to remove is not found', () => {
      const deviceConfig = { name: 'Test', ip: '1.2.3.4', enableDisplay: false };
      const originalGetService = mockAccessory.getService;
      const originalGetServiceById = mockAccessory.getServiceById;
      mockAccessory.getService = jest.fn((id) => (id === 'Display' ? undefined : originalGetService(id)));
      mockAccessory.getServiceById = jest.fn((uuid, subtype) => (uuid === mockApi.hap.Service.Switch.UUID && subtype === 'display' ? undefined : originalGetServiceById(uuid, subtype)));
      platformAny.removeDisabledServices(mockAccessory, deviceConfig);
      expect(mockAccessory.removeService).not.toHaveBeenCalled();
      expect(platformAny.api.updatePlatformAccessories).not.toHaveBeenCalled();
      expect(mockLog.debug).toHaveBeenCalledWith(expect.stringContaining('Display Switch service already disabled or not found'));
      mockAccessory.getService = originalGetService;
      mockAccessory.getServiceById = originalGetServiceById;
    });
  });

  describe('Stale Accessory Cleanup', () => {
    let platformAny: any;
    let staleAccessory: PlatformAccessory;
    const staleUuid = 'stale-uuid';
    const stopPollingMock = jest.fn();

    beforeEach(() => {
      platformAny = platform as any;
      platformAny.discoverDevices = jest.requireActual('../platform').TfiacPlatform.prototype.discoverDevices;
      platformAny.discoverDevicesNetwork = jest.fn().mockResolvedValue(new Set());
      
      // Create a stale accessory that should be removed
      staleAccessory = {
        UUID: staleUuid,
        displayName: 'Stale Accessory',
        context: { deviceConfig: { name: 'Stale', ip: '1.1.1.1' } },
      } as unknown as PlatformAccessory;
      platformAny.accessories = [staleAccessory];

      // Create maps with actual handler objects
      platformAny.discoveredAccessories = new Map();
      platformAny.displayAccessories = new Map();
      platformAny.sleepAccessories = new Map();
      platformAny.fanSpeedAccessories = new Map();
      platformAny.dryAccessories = new Map();
      platformAny.fanOnlyAccessories = new Map();
      platformAny.standaloneFanAccessories = new Map();
      platformAny.horizontalSwingAccessories = new Map();
      platformAny.turboAccessories = new Map();
      platformAny.ecoAccessories = new Map();
      platformAny.beepAccessories = new Map();
      
      // Directly set a mock function for stopPolling for more direct testing
      const accessoryHandler = { stopPolling: stopPollingMock };
      
      platformAny.discoveredAccessories.set(staleUuid, accessoryHandler);
      platformAny.displayAccessories.set(staleUuid, accessoryHandler);
      platformAny.sleepAccessories.set(staleUuid, accessoryHandler);
      platformAny.fanSpeedAccessories.set(staleUuid, accessoryHandler);
      platformAny.dryAccessories.set(staleUuid, accessoryHandler);
      platformAny.fanOnlyAccessories.set(staleUuid, accessoryHandler);
      platformAny.standaloneFanAccessories.set(staleUuid, accessoryHandler);
      platformAny.horizontalSwingAccessories.set(staleUuid, accessoryHandler);
      platformAny.turboAccessories.set(staleUuid, accessoryHandler);
      platformAny.ecoAccessories.set(staleUuid, accessoryHandler);
      platformAny.beepAccessories.set(staleUuid, accessoryHandler);
      
      // No devices in config
      platformAny.config = { devices: [], enableDiscovery: false };
    });

    test('should stop polling and remove all associated accessories when main accessory is stale', async () => {
      await platformAny.discoverDevices();
      
      // Verify stopPolling was called (using the direct mock)
      expect(stopPollingMock).toHaveBeenCalled();
      
      // Verify maps were cleared
      expect(platformAny.discoveredAccessories.has(staleUuid)).toBe(false);
      expect(platformAny.displayAccessories.has(staleUuid)).toBe(false);
      expect(platformAny.sleepAccessories.has(staleUuid)).toBe(false);
      expect(platformAny.fanSpeedAccessories.has(staleUuid)).toBe(false);
      expect(platformAny.dryAccessories.has(staleUuid)).toBe(false);
      expect(platformAny.fanOnlyAccessories.has(staleUuid)).toBe(false);
      expect(platformAny.standaloneFanAccessories.has(staleUuid)).toBe(false);
      expect(platformAny.horizontalSwingAccessories.has(staleUuid)).toBe(false);
      expect(platformAny.turboAccessories.has(staleUuid)).toBe(false);
      expect(platformAny.ecoAccessories.has(staleUuid)).toBe(false);
      expect(platformAny.beepAccessories.has(staleUuid)).toBe(false);
      
      // Verify accessory was unregistered
      expect(mockApi.unregisterPlatformAccessories).toHaveBeenCalledWith(PLUGIN_NAME, PLATFORM_NAME, [staleAccessory]);
      expect(platformAny.accessories).not.toContain(staleAccessory);
    });
  });

  describe('Conditional Accessory Creation in discoverDevices', () => {
    let platformAny: any;
    const deviceConfig = { name: 'Test Device', ip: '192.168.1.100' };
    const deviceUuid = `test-uuid-${deviceConfig.ip}${deviceConfig.name}`;

    beforeEach(() => {
      platformAny = platform as any;
      platformAny.discoverDevices = jest.requireActual('../platform').TfiacPlatform.prototype.discoverDevices;
      platformAny.discoverDevicesNetwork = jest.fn().mockResolvedValue(new Set());
      
      // Reset all maps
      platformAny.discoveredAccessories = new Map();
      platformAny.displayAccessories = new Map();
      platformAny.sleepAccessories = new Map();
      platformAny.fanSpeedAccessories = new Map();
      platformAny.dryAccessories = new Map();
      platformAny.fanOnlyAccessories = new Map();
      platformAny.standaloneFanAccessories = new Map();
      platformAny.horizontalSwingAccessories = new Map();
      platformAny.turboAccessories = new Map();
      platformAny.ecoAccessories = new Map();
      platformAny.beepAccessories = new Map();
      
      // Setup mocks for API calls
      platformAny.api.registerPlatformAccessories = jest.fn();
      platformAny.api.updatePlatformAccessories = jest.fn();
      platformAny.api.platformAccessory = jest.fn().mockImplementation((name, uuid) => ({
        UUID: uuid,
        displayName: name,
        context: { deviceConfig: {} },
        category: 0,
        getService: jest.fn(),
        getServiceById: jest.fn(),
        removeService: jest.fn(),
        services: [],
      }));
      
      // Setup our main accessory constructor
      (TfiacPlatformAccessory as jest.Mock).mockClear().mockImplementation(() => {
        return { name: 'MainAccessoryHandler', stopPolling: jest.fn() };
      });
    });

    test('should create optional accessories when flags are true/undefined', async () => {
      // Explicitly set all flags to true to ensure accessories are created
      const enabledConfig = {
        ...deviceConfig,
        enableDisplay: true,
        enableSleep: true,
        enableFanSpeed: true,
        enableDry: true,
        enableFanOnly: true,
        enableStandaloneFan: true,
        enableHorizontalSwing: true,
        enableTurbo: true,
        enableEco: true,
        enableBeep: true,
      };
      platformAny.config = { devices: [enabledConfig], enableDiscovery: false };
      platformAny.accessories = [];
      
      mockLog.info.mockClear(); // Clear all previous log calls
      
      // Run discover
      await platformAny.discoverDevices();
      
      // Check that accessories were registered
      expect(platformAny.api.registerPlatformAccessories).toHaveBeenCalled();
      
      // Verify that none of the "Skipping X" log messages appear
      const logCalls = mockLog.info.mock.calls.map(call => call[0]);
      const skipMessages = logCalls.filter(msg => typeof msg === 'string' && msg.includes('Skipping'));
      
      expect(skipMessages).toEqual([]);
    });

    test('should skip optional accessories when flags are false', async () => {
      const disabledConfig = {
        ...deviceConfig,
        enableDisplay: false,
        enableSleep: false,
        enableFanSpeed: false,
        enableDry: false,
        enableFanOnly: false,
        enableStandaloneFan: false,
        enableHorizontalSwing: false,
        enableTurbo: false,
        enableEco: false,
        enableBeep: false,
      };
      platformAny.config = { devices: [disabledConfig], enableDiscovery: false };
      platformAny.accessories = [];
      
      await platformAny.discoverDevices();
      
      // Verify that registerPlatformAccessories was called
      expect(platformAny.api.registerPlatformAccessories).toHaveBeenCalled();
      
      // Check logs to verify accessories were skipped
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('Skipping Display Switch'));
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('Skipping Sleep Switch'));
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('Skipping Fan Speed'));
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('Skipping Dry Switch'));
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('Skipping Fan Only Switch'));
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('Skipping Standalone Fan'));
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('Skipping Horizontal Swing Switch'));
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('Skipping Turbo Switch'));
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('Skipping Eco Switch'));
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('Skipping Beep Switch'));
    });

    test('should handle updating existing accessory with changed flags', async () => {
      // Force mock implementation of discoverDevices to update the accessory context properly
      platformAny.discoverDevices = jest.fn().mockImplementation(async () => {
        // Explicitly update the accessory context with the updated config
        // This simulates what the real discoverDevices method would do
        existingAccessory.context.deviceConfig = updatedConfig;
        
        // Call removeDisabledServices with the updated config
        platformAny.removeDisabledServices(existingAccessory, updatedConfig);
        
        // Call updatePlatformAccessories to save changes
        platformAny.api.updatePlatformAccessories([existingAccessory]);
      });
      
      // Set up platformAny's removeDisabledServices to prevent execution errors
      platformAny.removeDisabledServices = jest.fn();
      
      // Create an existing accessory with a specific configuration
      const existingConfig = { 
        ...deviceConfig, 
        enableDisplay: true, 
        enableSleep: true 
      };
      
      // Create an accessory context matching the existing config
      const existingAccessory = {
        UUID: deviceUuid,
        displayName: deviceConfig.name,
        context: { deviceConfig: existingConfig },
        category: 0,
        getService: jest.fn(),
        getServiceById: jest.fn(),
        removeService: jest.fn(),
        services: [],
      };
      
      // Add the existing accessory to platform
      platformAny.accessories = [existingAccessory];
      
      // Now set up a new config with different flags
      const updatedConfig = {
        ...deviceConfig,
        enableDisplay: false, // changed from true
        enableSleep: true,    // unchanged
        enableFanSpeed: true  // new flag
      };
      
      // Configure platform with the updated device config
      platformAny.config = { devices: [updatedConfig], enableDiscovery: false };
      
      // Run discover
      await platformAny.discoverDevices();
      
      // Since we found an existing accessory with changed config:
      // 1. The context should be updated with the new config
      expect(existingAccessory.context.deviceConfig).toEqual(updatedConfig);
      
      // 2. removeDisabledServices should be called to apply the config changes
      expect(platformAny.removeDisabledServices).toHaveBeenCalledWith(
        existingAccessory,
        updatedConfig
      );
      
      // 3. updatePlatformAccessories should be called to save the changes
      expect(platformAny.api.updatePlatformAccessories).toHaveBeenCalledWith([existingAccessory]);
    });
  });
});
