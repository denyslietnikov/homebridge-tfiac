import { vi, it, expect, describe, beforeEach, afterEach } from 'vitest';
import { PlatformAccessory } from 'homebridge';
import { OperationMode, PowerState } from '../enums.js';
import type { AirConditionerStatus } from '../AirConditionerAPI.js';
import type { TfiacPlatform } from '../platform.js';

// Define mock types first
interface MockService {
  setCharacteristic: ReturnType<typeof vi.fn>;
  getCharacteristic: ReturnType<typeof vi.fn>;
  updateCharacteristic: ReturnType<typeof vi.fn>;
}

interface MockCacheManager {
  api: {
    setAirConditionerState: ReturnType<typeof vi.fn>;
    updateState: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
  };
  clear: ReturnType<typeof vi.fn>;
  getStatus: ReturnType<typeof vi.fn>;
  cleanup: ReturnType<typeof vi.fn>;
}

interface MockAccessory extends PlatformAccessory {
  context: { deviceConfig: { name: string; ip: string; updateInterval: number } };
  displayName: string;
}

// First, mock BaseSwitchAccessory - this is the key to avoiding initialization issues
vi.mock('../BaseSwitchAccessory.js', () => {
  return {
    BaseSwitchAccessory: class MockBaseSwitchAccessory {
      platform: any;
      accessory: MockAccessory;
      protected serviceName: string;
      protected serviceSubtype: string;
      private getStatusValue: (status: AirConditionerStatus) => boolean;
      private setApiState: (value: boolean) => Promise<void>;
      protected logPrefix: string;
      protected service: MockService;
      protected cacheManager: MockCacheManager;

      constructor(
        platform: any,
        accessory: MockAccessory,
        serviceName: string,
        serviceSubtype: string,
        getStatusValue: (status: AirConditionerStatus) => boolean,
        setApiState: (value: boolean) => Promise<void>,
        logPrefix: string
      ) {
        this.platform = platform;
        this.accessory = accessory;
        this.serviceName = serviceName;
        this.serviceSubtype = serviceSubtype;
        this.getStatusValue = getStatusValue;
        this.setApiState = setApiState;
        this.logPrefix = logPrefix;

        // Create a mock service
        this.service = {
          setCharacteristic: vi.fn().mockReturnThis(),
          getCharacteristic: vi.fn().mockReturnValue({
            on: vi.fn().mockReturnThis(),
            onGet: vi.fn().mockReturnThis(),
            onSet: vi.fn().mockReturnThis(),
          }),
          updateCharacteristic: vi.fn()
        };

        // Mock cacheManager
        this.cacheManager = {
          api: {
            setAirConditionerState: vi.fn().mockResolvedValue({}),
            updateState: vi.fn().mockResolvedValue({ 
              operation_mode: OperationMode.Auto,
              is_on: PowerState.On,
              target_temp: 25,
              current_temp: 22,
              fan_mode: 'auto',
              swing_mode: 'off'
            }),
            on: vi.fn(),
            off: vi.fn()
          },
          clear: vi.fn(),
          getStatus: vi.fn().mockResolvedValue({ 
            operation_mode: OperationMode.Auto,
            is_on: PowerState.On,
            target_temp: 25,
            current_temp: 22,
            fan_mode: 'auto',
            swing_mode: 'off'
          }),
          cleanup: vi.fn()
        };
      }
      
      updateStatus(status: Partial<AirConditionerStatus>) {
        return this.service.updateCharacteristic('On', this.getStatusValue(status as AirConditionerStatus));
      }
      
      stopPolling() {
        // No-op in the mock
      }
    }
  };
});

// Now import FanOnlySwitchAccessory after the mock is set up
import { FanOnlySwitchAccessory } from '../FanOnlySwitchAccessory.js';

// Create a more complete platform mock that satisfies TfiacPlatform interface
const mockPlatform = {
  Service: { Switch: vi.fn() },
  Characteristic: { Name: 'Name', On: 'On' },
  log: { debug: vi.fn(), info: vi.fn(), error: vi.fn() },
  config: {},
  api: {},
  accessories: [],
  discoveredAccessories: new Map(),
  displayAccessories: new Map(),
  fanSpeedAccessories: new Map(),
  indoorTemperatureSensorAccessories: new Map(),
  outdoorTemperatureSensorAccessories: new Map(),
  airConditionerLookup: new Map(),
  echoAccessories: new Map(),
  displaySwitchAccessories: new Map(),
  turboSwitchAccessories: new Map(),
  drySwitchAccessories: new Map(),
  beepSwitchAccessories: new Map(),
  ecoSwitchAccessories: new Map(),
  fanOnlySwitchAccessories: new Map(),
  sleepSwitchAccessories: new Map(),
  horizontalSwingSwitchAccessories: new Map(),
  standaloneFanAccessories: new Map(),
  registerPlatformAccessories: vi.fn(),
  unregisterPlatformAccessories: vi.fn(),
  refreshDeviceStatus: vi.fn(),
  removeAccessory: vi.fn()
} as unknown as TfiacPlatform;

const mockAccessory = {
  context: { deviceConfig: { name: 'AC', ip: '1.2.3.4', updateInterval: 1 } },
  displayName: 'Test Accessory',
  getService: vi.fn(),
  getServiceById: vi.fn(),
  addService: vi.fn()
} as unknown as MockAccessory;

// Helper function to create a full AirConditionerStatus object
function createStatus(mode: OperationMode): AirConditionerStatus {
  return {
    operation_mode: mode,
    is_on: PowerState.On,
    target_temp: 25,
    current_temp: 22,
    fan_mode: 'auto',
    swing_mode: 'off'
  };
}

describe('FanOnlySwitchAccessory – unit', () => {
  let fanOnlySwitch: any; // Use any to bypass strict typechecking for testing 
  
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  afterEach(() => {
    if (fanOnlySwitch) {
      fanOnlySwitch.stopPolling();
    }
  });

  it('should initialize with correct parameters', () => {
    fanOnlySwitch = new FanOnlySwitchAccessory(mockPlatform, mockAccessory);
    
    // Access private properties for testing purpose
    expect(fanOnlySwitch['serviceName']).toBe('Fan Only');
    expect(fanOnlySwitch['serviceSubtype']).toBe('fanonly');
    expect(fanOnlySwitch['logPrefix']).toBe('Fan Only');
  });

  it('should correctly identify fan_only mode in the status object', () => {
    fanOnlySwitch = new FanOnlySwitchAccessory(mockPlatform, mockAccessory);
    
    // Test with FanOnly mode
    expect(fanOnlySwitch['getStatusValue'](createStatus(OperationMode.FanOnly))).toBe(true);
    
    // Test with other modes
    expect(fanOnlySwitch['getStatusValue'](createStatus(OperationMode.Auto))).toBe(false);
    expect(fanOnlySwitch['getStatusValue'](createStatus(OperationMode.Cool))).toBe(false);
    expect(fanOnlySwitch['getStatusValue'](createStatus(OperationMode.Heat))).toBe(false);
    expect(fanOnlySwitch['getStatusValue'](createStatus(OperationMode.Dry))).toBe(false);
  });

  it('should set operation mode to fan_only when turning on', async () => {
    fanOnlySwitch = new FanOnlySwitchAccessory(mockPlatform, mockAccessory);
    
    await fanOnlySwitch['setApiState'](true);
    
    expect(fanOnlySwitch['cacheManager'].api.setAirConditionerState)
      .toHaveBeenCalledWith('operation_mode', OperationMode.FanOnly);
  });

  it('should set operation mode to auto when turning off', async () => {
    fanOnlySwitch = new FanOnlySwitchAccessory(mockPlatform, mockAccessory);
    
    await fanOnlySwitch['setApiState'](false);
    
    expect(fanOnlySwitch['cacheManager'].api.setAirConditionerState)
      .toHaveBeenCalledWith('operation_mode', OperationMode.Auto);
  });

  it('should update the characteristic based on status', () => {
    fanOnlySwitch = new FanOnlySwitchAccessory(mockPlatform, mockAccessory);
    
    // Test with fan_only mode - should be ON
    fanOnlySwitch.updateStatus(createStatus(OperationMode.FanOnly));
    expect(fanOnlySwitch['service'].updateCharacteristic).toHaveBeenCalledWith('On', true);
    
    vi.clearAllMocks();
    
    // Test with auto mode - should be OFF
    fanOnlySwitch.updateStatus(createStatus(OperationMode.Auto));
    expect(fanOnlySwitch['service'].updateCharacteristic).toHaveBeenCalledWith('On', false);
  });
});