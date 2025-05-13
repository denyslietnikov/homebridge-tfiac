import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DisplaySwitchAccessory } from '../DisplaySwitchAccessory.js';
import type { PlatformAccessory } from 'homebridge';
import { PowerState } from '../enums.js';
import { EventEmitter } from 'events';

// A minimal mock CacheManager/DeviceState implementation
class MockDeviceState extends EventEmitter {
  public displayMode = PowerState.Off;
  constructor() {
    super();
  }
  clone() {
    const cloned = new MockDeviceState();
    cloned.displayMode = this.displayMode;
    return cloned;
  }
  setDisplayMode(mode: PowerState) {
    const changed = this.displayMode !== mode;
    this.displayMode = mode;
    if (changed) {
      this.emit('stateChanged', this);
    }
  }
  toApiStatus() { return { opt_display: this.displayMode }; }
  toPlainObject() { return { displayMode: this.displayMode }; }
  // on, emit, removeListener are inherited from EventEmitter
}
class MockCacheManager {
  public deviceState = new MockDeviceState();
  getDeviceState() { return this.deviceState; }
  applyStateToDevice = vi.fn().mockImplementation(async (stateToApply: MockDeviceState) => {
    // Simulate that applying the state updates the main deviceState
    this.deviceState.setDisplayMode(stateToApply.displayMode);
    return Promise.resolve(undefined);
  });
  getStatus = vi.fn().mockImplementation(async function() { // Changed to regular function
    return Promise.resolve({ opt_display: this.deviceState.displayMode });
  });
  getLastStatus = vi.fn().mockReturnValue(undefined);
  updateDeviceState = vi.fn().mockResolvedValue(new MockDeviceState());
}

// A minimal mock Platform and Accessory
const mockPlatform = {
  Characteristic: { 
    On: { UUID: 'On' },
    Name: { UUID: 'Name' },
  },
  Service: { 
    Switch: vi.fn().mockImplementation((displayName: string, subtype: string) => ({
      displayName,
      UUID: '00000049-0000-1000-8000-0026BB765291',
      subtype,
      setCharacteristic: vi.fn().mockReturnThis(),
      getCharacteristic: vi.fn().mockReturnValue({
        onGet: vi.fn().mockReturnThis(),
        onSet: vi.fn().mockReturnThis(),
        updateValue: vi.fn().mockReturnThis(),
      }),
      updateCharacteristic: vi.fn(),
    }))
  },
  api: {
    hap: {
      HapStatusError: class HapStatusError extends Error {
        public hapStatus: number;
        constructor(hapStatus: number) {
          super(`HapStatusError: ${hapStatus}`);
          this.hapStatus = hapStatus;
        }
      },
      HAPStatus: {
        SERVICE_COMMUNICATION_FAILURE: -70402,
      }
    }
  },
  log: { debug: vi.fn(), info: vi.fn(), error: vi.fn() },
} as any;

function createAccessory(): PlatformAccessory {
  const char = {
    onGet: vi.fn().mockReturnThis(),
    onSet: vi.fn().mockReturnThis(),
    updateValue: vi.fn(),
    value: null,
  };
  const service = {
    setCharacteristic: vi.fn().mockReturnThis(),
    getCharacteristic: vi.fn().mockReturnValue(char),
    updateCharacteristic: vi.fn(),
    displayName: 'Display',
    UUID: '00000049-0000-1000-8000-0026BB765291',
    subtype: 'display',
  };
  const accessory = {
    context: { deviceConfig: { name: 'Test AC', ip: '192.168.1.100' } },
    getServiceById: vi.fn().mockReturnValue(undefined),
    getService: vi.fn().mockReturnValue(undefined),
    addService: vi.fn().mockReturnValue(service),
    services: [] as any[],
  } as any;
  return accessory;
}

describe('DisplaySwitchAccessory', () => {
  let accessory: PlatformAccessory;
  let cacheManager: MockCacheManager;
  let displaySwitch: DisplaySwitchAccessory;
  let charOn: any;
  let service: any;

  beforeEach(() => {
    accessory = createAccessory();
    cacheManager = new MockCacheManager();
    
    // Add cacheManager to context for test
    accessory.context.cacheManager = cacheManager;
    
    // Create the accessory
    displaySwitch = new DisplaySwitchAccessory(mockPlatform, accessory);
    
    // Grab the service and characteristic for testing
    // The service is now directly returned by addService mock
    service = (accessory.addService as any).mock.results[0]?.value;
    
    charOn = service.getCharacteristic(mockPlatform.Characteristic.On);
  });

  it('should be created and register a service', () => {
    expect(accessory.addService).toHaveBeenCalled();
  });

  it('onGet should reflect deviceState.displayMode', async () => {
    // Extract the onGet handler
    const onGetHandler = charOn.onGet.mock.calls[0][0];
    
    // Set up the deviceState
    cacheManager.deviceState.setDisplayMode(PowerState.On);
    
    // The mock deviceState.toApiStatus() returns { opt_display: PowerState.On }
    // DisplaySwitchAccessory getStatusValue checks status.opt_display === PowerState.On
    // So onGetHandler() should return true
    expect(await onGetHandler()).toBe(true);
    
    // Change state and test again
    cacheManager.deviceState.setDisplayMode(PowerState.Off);
    expect(await onGetHandler()).toBe(false);
  });

  it('onSet should call setDisplayMode and applyStateToDevice', async () => {
    // Extract the onSet handler
    const onSetHandler = charOn.onSet.mock.calls[0][0];
    const callback = vi.fn();
    
    // Call onSet with true
    await onSetHandler(true, callback);
    expect(cacheManager.deviceState.displayMode).toBe(PowerState.On);
    expect(cacheManager.applyStateToDevice).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(null);
    
    // Call onSet with false
    cacheManager.applyStateToDevice.mockClear();
    callback.mockClear();
    await onSetHandler(false, callback);
    expect(cacheManager.deviceState.displayMode).toBe(PowerState.Off);
    expect(cacheManager.applyStateToDevice).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(null);
  });

  it('updateStatus updates characteristic via updateCharacteristic', () => {
    // First check that the service is accessible
    expect(service).toBeTruthy();
    expect(service.updateCharacteristic).toBeDefined();
    
    // Now test the updateStatus method with display on
    displaySwitch.updateStatus({ opt_display: PowerState.On } as any);
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      mockPlatform.Characteristic.On, 
      true
    );
    
    // Reset the mock and test with display off
    service.updateCharacteristic.mockClear();
    displaySwitch.updateStatus({ opt_display: PowerState.Off } as any);
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      mockPlatform.Characteristic.On, 
      false
    );
  });
});