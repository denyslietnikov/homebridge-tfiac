import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DisplaySwitchAccessory } from '../DisplaySwitchAccessory.js';
import type { PlatformAccessory } from 'homebridge';
import { PowerState } from '../enums.js';
import { EventEmitter } from 'events';
import type { DeviceState } from '../state/DeviceState.js';

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
  toApiStatus(): any { return { opt_display: this.displayMode }; }
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
  getStatus = vi.fn().mockImplementation(async function(this: any) {
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
    ConfiguredName: { UUID: 'ConfiguredName' }
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
        value: false
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
  log: { debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() },
} as any;

function createAccessory(): PlatformAccessory {
  const char = {
    onGet: vi.fn().mockReturnThis(),
    onSet: vi.fn().mockReturnThis(),
    updateValue: vi.fn(),
    value: false,
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

describe('DisplaySwitchAccessory Enhanced Tests', () => {
  let accessory: PlatformAccessory;
  let cacheManager: MockCacheManager;
  let displaySwitch: DisplaySwitchAccessory;
  let charOn: any;
  let service: any;
  let originalDeviceState: any;

  beforeEach(() => {
    accessory = createAccessory();
    cacheManager = new MockCacheManager();
    
    // Add cacheManager to context for test
    accessory.context.cacheManager = cacheManager;
    
    // Create the accessory
    displaySwitch = new DisplaySwitchAccessory(mockPlatform, accessory);
    
    // Grab the service and characteristic for testing
    service = (accessory.addService as any).mock.results[0]?.value;
    charOn = service.getCharacteristic(mockPlatform.Characteristic.On);
    
    // Store original deviceState methods for restoration
    originalDeviceState = cacheManager.deviceState;
  });

  afterEach(() => {
    // Restore original deviceState methods
    vi.restoreAllMocks();
  });

  it('should handle null status in getStatusValue function', async () => {
    // Extract the onGet handler
    const onGetHandler = charOn.onGet.mock.calls[0][0];
    
    // Override toApiStatus to return null
    vi.spyOn(cacheManager.deviceState, 'toApiStatus').mockReturnValue(null);
    
    // Call the handler and expect false
    expect(await onGetHandler()).toBe(false);
  });

  it('should handle undefined opt_display in status object', async () => {
    // Extract the onGet handler
    const onGetHandler = charOn.onGet.mock.calls[0][0];
    
    // Override toApiStatus to return an object without opt_display
    vi.spyOn(cacheManager.deviceState, 'toApiStatus').mockReturnValue({});
    
    // Call the handler and expect false
    expect(await onGetHandler()).toBe(false);
  });

  it('should handle DeviceState directly being passed to getStatusValue', () => {
    // We need to access the getStatusValue function that was passed to BaseSwitchAccessory
    // Since we can't directly access it, we'll trigger the stateChanged event which calls
    // handleStateChange, which in turn calls getStatusValue

    // First, verify we can detect the correct state when passing normal API status
    cacheManager.deviceState.setDisplayMode(PowerState.On);
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      mockPlatform.Characteristic.On, 
      true
    );

    // Now, modify the toApiStatus to pass the DeviceState itself when first called
    let callCount = 0;
    const originalToApiStatus = cacheManager.deviceState.toApiStatus;
    vi.spyOn(cacheManager.deviceState, 'toApiStatus').mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // This forces the instanceof DeviceState check branch to be taken
        return originalDeviceState;
      }
      // On second call (inside the branch), return normal API status
      return { opt_display: PowerState.On };
    });

    // Reset mocks and trigger again
    service.updateCharacteristic.mockClear();
    cacheManager.deviceState.emit('stateChanged', cacheManager.deviceState);
    
    // Should still correctly update to true
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      mockPlatform.Characteristic.On,
      true
    );
  });
  
  it('should handle error during applyStateToDevice', async () => {
    // Extract the onSet handler
    const onSetHandler = charOn.onSet.mock.calls[0][0];
    const callback = vi.fn();
    
    // Make applyStateToDevice throw an error
    cacheManager.applyStateToDevice.mockRejectedValueOnce(new Error('Network failure'));
    
    // Call onSet and expect error to be handled
    await onSetHandler(true, callback);
    
    // Check that error handling worked
    expect(mockPlatform.log.error).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(expect.any(mockPlatform.api.hap.HapStatusError));
  });

  it('should handle direct access to deviceState in setApiState', async () => {
    // Extract the onSet handler 
    const onSetHandler = charOn.onSet.mock.calls[0][0];
    const callback = vi.fn();

    // Call onSet with true and verify the deep chain of calls
    await onSetHandler(true, callback);
    
    // Verify that log.debug was called with the correct message
    expect(mockPlatform.log.debug).toHaveBeenCalledWith('SET Display -> ON');
    
    // Verify that a clone of the state was created
    expect(cacheManager.applyStateToDevice).toHaveBeenCalled();
    
    // The cloned object should have had setDisplayMode called with PowerState.On
    expect(cacheManager.deviceState.displayMode).toBe(PowerState.On);
  });
  
  it('should properly propagate error from applyStateToDevice', async () => {
    // Extract the onSet handler
    const onSetHandler = charOn.onSet.mock.calls[0][0];
    const callback = vi.fn();
    
    // Mock the HapStatusError to test specific error cases
    const hapError = new mockPlatform.api.hap.HapStatusError(
      mockPlatform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
    );
    cacheManager.applyStateToDevice.mockRejectedValueOnce(hapError);
    
    // Call onSet and verify error handling
    await onSetHandler(true, callback);
    
    // Verify error was logged
    expect(mockPlatform.log.error).toHaveBeenCalled();
    
    // Verify callback was called with the HapStatusError
    expect(callback).toHaveBeenCalledWith(hapError);
  });
});
