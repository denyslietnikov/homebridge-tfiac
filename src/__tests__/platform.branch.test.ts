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
    mockApi.hap.Categories = { AIR_CONDITIONER: 21 };
    
    // Capture the didFinishLaunching callback
    mockApi.on.mockImplementation((event, callback) => {
      if (event === 'didFinishLaunching') {
        didFinishLaunchingCallback = callback;
      }
    });
    
    // Mock Accessory with some services
    mockAccessory = {
      UUID: 'test-uuid',
      displayName: 'Test Accessory',
      context: { deviceConfig: { name: 'Test', ip: '1.2.3.4' } },
      getService: vi.fn((identifier: string | { UUID: string }, subtype?: string) => {
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
      getServiceById: vi.fn((uuid: string, subtype: string) => {
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
      removeService: vi.fn(),
      services: [
        { UUID: mockApi.hap.Service.TemperatureSensor.UUID, subtype: 'tempsensor', displayName: 'Temperature Sensor' },
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
      expect(updateAccessoriesSpy).not.toHaveBeenCalled();
      expect(mockLog.debug).toHaveBeenCalledWith(
        `No services needed removal for ${mockAccessory.displayName}.`
      );
    });

    it('removes Display Switch when enableDisplay is false', () => {
      const deviceConfig = { enableDisplay: false } as any;
      const displayService = mockAccessory.getService('Display');
      (platform as any).removeDisabledServices(mockAccessory, deviceConfig);
      expect(mockAccessory.removeService).toHaveBeenCalledWith(displayService);
      expect(updateAccessoriesSpy).toHaveBeenCalledWith([mockAccessory]);
      expect(mockLog.info).toHaveBeenCalledWith(
        `Removed Display Switch service from ${mockAccessory.displayName}`
      );
    });

    it('removes Fan Speed when enableFanSpeed is false', () => {
      const deviceConfig = { enableFanSpeed: false } as any;
      (platform as any).removeDisabledServices(mockAccessory, deviceConfig);
      // getService returns undefined, fallback to Fanv2 by subtype 'fanspeed'
      const fanService = mockAccessory.getServiceById(
        mockApi.hap.Service.Fanv2.UUID,
        'fanspeed'
      );
      expect(mockAccessory.removeService).toHaveBeenCalledWith(fanService);
      expect(updateAccessoriesSpy).toHaveBeenCalledWith([mockAccessory]);
      expect(mockLog.info).toHaveBeenCalledWith(
        `Removed Fan Speed service from ${mockAccessory.displayName}`
      );
    });

    it('removes temperature sensor when enableTemperature is false', () => {
      const deviceConfig = { enableTemperature: false } as any;
      (platform as any).removeDisabledServices(mockAccessory, deviceConfig);
      const tempServices = mockAccessory.services.filter(
        s => s.UUID === mockApi.hap.Service.TemperatureSensor.UUID
      );
      // removeService called for each temp sensor
      tempServices.forEach(svc => {
        expect(mockAccessory.removeService).toHaveBeenCalledWith(svc);
      });
      expect(updateAccessoriesSpy).toHaveBeenCalledWith([mockAccessory]);
      expect(mockLog.info).toHaveBeenCalledWith(
        `Temperature sensor is disabled for ${mockAccessory.displayName}. Removing ${tempServices.length} sensor(s).`
      );
    });
  });
});
