// platform.branch.test.ts
import { vi, describe, beforeEach, it, test, expect } from 'vitest';
import { PlatformAccessory, PlatformConfig } from 'homebridge';
import { TfiacPlatform } from '../platform';
import { PLUGIN_NAME, PLATFORM_NAME, TfiacPlatformConfig } from '../settings.js';
import { TfiacPlatformAccessory } from '../platformAccessory.js';
import {
  createMockLogger,
  createMockAPI,
  createMockPlatformAccessory,
  MockLogger,
  MockAPI,
} from './testUtils';

// Mock modules with jest functions
vi.mock('../platformAccessory');
vi.mock('../DisplaySwitchAccessory', () => ({
  DisplaySwitchAccessory: vi.fn(() => ({ name: 'DisplaySwitchAccessory' }))
}));
vi.mock('../SleepSwitchAccessory', () => ({
  SleepSwitchAccessory: vi.fn(() => ({ name: 'SleepSwitchAccessory' }))
}));
vi.mock('../FanSpeedAccessory', () => ({
  FanSpeedAccessory: vi.fn(() => ({ name: 'FanSpeedAccessory' }))
}));
vi.mock('../DrySwitchAccessory', () => ({
  DrySwitchAccessory: vi.fn(() => ({ name: 'DrySwitchAccessory' }))
}));
vi.mock('../FanOnlySwitchAccessory', () => ({
  FanOnlySwitchAccessory: vi.fn(() => ({ name: 'FanOnlySwitchAccessory' }))
}));
vi.mock('../StandaloneFanAccessory', () => ({
  StandaloneFanAccessory: vi.fn(() => ({ name: 'StandaloneFanAccessory' }))
}));
vi.mock('../HorizontalSwingSwitchAccessory', () => ({
  HorizontalSwingSwitchAccessory: vi.fn(() => ({ name: 'HorizontalSwingSwitchAccessory' }))
}));
vi.mock('../TurboSwitchAccessory', () => ({
  TurboSwitchAccessory: vi.fn(() => ({ name: 'TurboSwitchAccessory' }))
}));
vi.mock('../EcoSwitchAccessory', () => ({
  EcoSwitchAccessory: vi.fn(() => ({ name: 'EcoSwitchAccessory' }))
}));
vi.mock('../BeepSwitchAccessory', () => ({
  BeepSwitchAccessory: vi.fn(() => ({ name: 'BeepSwitchAccessory' }))
}));

describe('TfiacPlatform branch coverage tests', () => {
  let platform: TfiacPlatform;
  let mockLog: MockLogger;
  let mockApi: MockAPI;
  let mockConfig: TfiacPlatformConfig;
  let mockAccessory: PlatformAccessory;
  let didFinishLaunchingCallback: () => void;
  // Declare service instances in the describe scope
  let mockDisplayServiceViaDisplayName: { UUID: string; subtype: string; displayName: string };
  let mockDisplayServiceViaId: { UUID: string; subtype: string; displayName: string };
  let mockFanSpeedService: { UUID: string; subtype: string; displayName: string };
  let mockTempSensorServiceInstance: { UUID: string; subtype: string; displayName: string };

  beforeEach(() => {
    // Reset mocks for each test
    vi.clearAllMocks();
    
    // Create mocks using testUtils
    mockLog = createMockLogger();
    mockApi = createMockAPI();
    
    // Configure additional API properties needed for these tests
    mockApi.hap.Service.Switch = { UUID: 'switch-uuid' };
    mockApi.hap.Service.Fanv2 = { UUID: 'fanv2-uuid' };
    mockApi.hap.Service.TemperatureSensor = { UUID: 'temp-sensor-uuid' };
    
    // Capture the didFinishLaunching callback
    mockApi.on.mockImplementation((event, callback) => {
      if (event === 'didFinishLaunching') {
        didFinishLaunchingCallback = callback;
      }
    });

    // Assign service instances
    mockDisplayServiceViaDisplayName = { UUID: 'DisplayServiceUUID_ViaName', subtype: 'display_from_name', displayName: 'Display Light' };
    mockDisplayServiceViaId = { UUID: 'DisplayServiceUUID_ViaId', subtype: 'display', displayName: 'Display by ID' };
    mockFanSpeedService = { UUID: 'FanSpeedServiceUUID', subtype: 'fanspeed', displayName: 'Fan Speed Control by ID' };
    mockTempSensorServiceInstance = { UUID: mockApi.hap.Service.TemperatureSensor.UUID, subtype: 'tempsensor', displayName: 'Temperature Sensor' };
    
    // Mock Accessory with some services
    mockAccessory = {
      UUID: 'test-uuid',
      displayName: 'Test Accessory',
      context: { deviceConfig: { name: 'Test', ip: '1.2.3.4' } },
      getService: vi.fn((identifier: string | { UUID: string }) => {
        if (typeof identifier === 'string') {
          if (identifier === 'Display Light') return mockDisplayServiceViaDisplayName;
          if (identifier === 'Sleep Mode') return { UUID: 'SleepServiceUUID', subtype: 'sleepmode', displayName: 'Sleep Mode' };
        }
        return undefined;
      }),
      getServiceById: vi.fn((uuid: string, subtype?: string) => {
        if (uuid === mockApi.hap.Service.Switch.UUID) {
          if (subtype === 'display') return mockDisplayServiceViaId;
          if (subtype === 'sleep') return { UUID: 'SleepServiceUUID_ViaId', subtype: 'sleep', displayName: 'Sleep by ID' };
        } else if (uuid === mockApi.hap.Service.Fanv2.UUID) {
          if (subtype === 'fanspeed') return mockFanSpeedService;
        } else if (uuid === mockApi.hap.Service.TemperatureSensor.UUID) {
          return mockTempSensorServiceInstance;
        }
        return undefined;
      }),
      removeService: vi.fn(),
      services: [
        mockTempSensorServiceInstance,
        mockDisplayServiceViaDisplayName,
        mockFanSpeedService,
        { UUID: 'OtherServiceUUID', subtype: 'other', displayName: 'Other Service' },
      ],
    } as unknown as PlatformAccessory;
    
    // Override the platformAccessory mock to return our custom accessory
    mockApi.platformAccessory.mockReturnValue(mockAccessory);
    
    // Default config
    mockConfig = {
      platform: PLATFORM_NAME,
      name: 'Test Platform',
      devices: [],
      enableDiscovery: false,
    };
    
    // Create platform instance
    platform = new TfiacPlatform(mockLog as any, mockConfig, mockApi as any);
    
    // Mock methods that need to be spied on
    vi.spyOn(platform, 'discoverDevices').mockImplementation(async () => {});
  });

  describe('removeDisabledServices', () => {
    let updateAccessoriesSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      updateAccessoriesSpy = vi.spyOn(mockApi, 'updatePlatformAccessories');
      mockAccessory.removeService = vi.fn();
      mockLog.debug = vi.fn();
      mockLog.info = vi.fn();
    });

    it('does nothing when no features disabled', () => {
      const deviceConfig = {} as any;
      (platform as any).removeDisabledServices(mockAccessory, deviceConfig);

      expect(mockAccessory.removeService).not.toHaveBeenCalled();
      expect(mockLog.debug).toHaveBeenCalledWith('No services needed removal for Test Accessory.');
      expect(updateAccessoriesSpy).not.toHaveBeenCalled();
    });

    it('removes Display Switch when enableDisplaySwitch is false', () => {
      const deviceConfig = { name: mockAccessory.displayName, enableDisplay: false, debug: true } as any;
      const expectedServiceToRemove = mockDisplayServiceViaDisplayName;

      (platform as any).removeDisabledServices(mockAccessory, deviceConfig);

      expect(mockAccessory.removeService).toHaveBeenCalledWith(expectedServiceToRemove);
      expect(mockLog.debug).toHaveBeenCalledWith('[Test Accessory] Removed service: Display Light');
      expect(mockLog.info).toHaveBeenCalledWith(
        'Updating accessory Test Accessory after removing disabled services.'
      );
      expect(updateAccessoriesSpy).toHaveBeenCalledWith([mockAccessory]);
    });

    it('removes Fan Speed when enableFanSpeedSwitch is false', () => {
      const deviceConfig = { name: mockAccessory.displayName, enableFanSpeed: false, debug: true } as any;
      const expectedServiceToRemove = mockFanSpeedService as any;

      mockAccessory.getService = vi.fn((identifier: string | { UUID: string }) => {
        if (typeof identifier === 'string') {
          if (identifier === 'Display Light') return mockDisplayServiceViaDisplayName as any;
          if (identifier === 'Fan Speed Control') return mockFanSpeedService as any;
        }
        return undefined;
      }) as any;

      (platform as any).removeDisabledServices(mockAccessory, deviceConfig);

      expect(mockAccessory.removeService).toHaveBeenCalledWith(expectedServiceToRemove);
      expect(mockLog.debug).toHaveBeenCalledWith('[Test Accessory] Removed service: Fan Speed Control');
      expect(mockLog.info).toHaveBeenCalledWith(
        'Updating accessory Test Accessory after removing disabled services.'
      );
      expect(updateAccessoriesSpy).toHaveBeenCalledWith([mockAccessory]);
    });

    it('removes temperature sensor when enableTemperature is false', () => {
      const deviceConfig = { name: mockAccessory.displayName, enableTemperature: false, debug: true } as any;

      mockAccessory.getServiceById = vi.fn((uuid: string, subtype?: string) => {
        if (uuid === mockApi.hap.Service.TemperatureSensor.UUID && subtype === 'indoor_temperature') {
          return mockTempSensorServiceInstance as any;
        }
        return undefined;
      }) as any;

      (platform as any).removeDisabledServices(mockAccessory, deviceConfig);

      expect(mockAccessory.removeService).toHaveBeenCalledWith(mockTempSensorServiceInstance as any);
      expect(mockLog.debug).toHaveBeenCalledWith('[Test Accessory] Removed existing indoor temperature sensor service.');
      expect(mockLog.info).toHaveBeenCalledWith('Temperature sensors are disabled for Test Accessory - removing any that were cached.');
      expect(mockLog.info).toHaveBeenCalledWith(
        'Updating accessory Test Accessory after removing disabled services.'
      );
      expect(updateAccessoriesSpy).toHaveBeenCalledWith([mockAccessory]);
    });
  });
});
