import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DisplaySwitchAccessory } from '../DisplaySwitchAccessory.js';
import type { PlatformAccessory } from 'homebridge';
import { PowerState } from '../enums.js';
import { EventEmitter } from 'events';
import type { DeviceState } from '../state/DeviceState.js';

// Mock DeviceState class
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

// Mock CacheManager class
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

// Mock Platform
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

// Create mock accessory
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

describe('DisplaySwitchAccessory Coverage Tests', () => {
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
    
    // Verify that DisplaySwitchAccessory properly extends BaseSwitchAccessory
    expect(displaySwitch).toHaveProperty('handleGet');
    expect(typeof (displaySwitch as any).handleGet).toBe('function');
    
    // Grab the service and characteristic for testing
    service = (accessory.addService as any).mock.results[0]?.value;
    charOn = service.getCharacteristic(mockPlatform.Characteristic.On);
    
    // Instead of trying to directly manipulate mock.calls which is a getter-only property,
    // we'll extract the handlers directly from the DisplaySwitchAccessory instance
    
    // Reset mocks
    vi.clearAllMocks();
  });
  
  afterEach(() => {
    vi.clearAllMocks();
  });

  // Helper function to access handlers either directly from the instance or via mock.calls
  function getHandlers() {
    // Try to access methods directly on the instance if they're publicly accessible
    // (BaseSwitchAccessory.handleGet is public, handleSet is protected)
    if (typeof (displaySwitch as any).handleGet === 'function') {
      const directGet = (displaySwitch as any).handleGet.bind(displaySwitch);
      
      // For handleSet, check if we can access it or fall back to the mock
      let directSet;
      if (typeof (displaySwitch as any).handleSet === 'function') {
        directSet = (displaySwitch as any).handleSet.bind(displaySwitch);
      } else if (charOn.onSet.mock.calls.length > 0) {
        directSet = charOn.onSet.mock.calls[0][0];
      } else {
        throw new Error('Cannot access handleSet method');
      }
      
      return { 
        onGetHandler: directGet,
        onSetHandler: directSet
      };
    }
    
    // Fallback to using the mock.calls if direct access is not available
    if (charOn.onGet.mock.calls.length > 0 && charOn.onSet.mock.calls.length > 0) {
      return {
        onGetHandler: charOn.onGet.mock.calls[0][0],
        onSetHandler: charOn.onSet.mock.calls[0][0]
      };
    }
    
    throw new Error('Cannot extract handlers from DisplaySwitchAccessory');
  }

  it('should handle undefined status in toApiStatus', async () => {
    // Extract the handlers
    const { onGetHandler } = getHandlers();
    
    // Mock deviceState to return undefined for toApiStatus
    vi.spyOn(cacheManager.deviceState, 'toApiStatus').mockReturnValue(undefined);
    
    // Call onGet and verify it returns false for undefined status
    expect(await onGetHandler()).toBe(false);
  });

  it('should handle null deviceState in getStatusValue', async () => {
    // Extract the handlers
    const { onGetHandler } = getHandlers();
    
    // Mock getDeviceState to return null
    vi.spyOn(cacheManager, 'getDeviceState').mockReturnValue(null as any);
    
    // Call onGet and expect it to handle null deviceState gracefully
    expect(await onGetHandler()).toBe(false);
  });

  it('should handle failure in cloning deviceState', async () => {
    // Extract the handlers
    const { onSetHandler } = getHandlers();
    const callback = vi.fn();
    
    // Mock clone to throw an error
    vi.spyOn(cacheManager.deviceState, 'clone').mockImplementation(() => {
      throw new Error('Clone failed');
    });
    
    // Call onSet and verify error handling
    await onSetHandler(true, callback);
    
    // Verify error was logged
    expect(mockPlatform.log.error).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(expect.any(Error));
  });

  it('should handle exception when setting display mode', async () => {
    // Extract the handlers
    const { onSetHandler } = getHandlers();
    const callback = vi.fn();
    
    // Mock setDisplayMode to throw an error
    const clonedState = new MockDeviceState();
    vi.spyOn(cacheManager.deviceState, 'clone').mockReturnValue(clonedState);
    vi.spyOn(clonedState, 'setDisplayMode').mockImplementation(() => {
      throw new Error('setDisplayMode failed');
    });
    
    // Call onSet and verify error handling
    await onSetHandler(true, callback);
    
    // Verify error was logged and callback was called with error
    expect(mockPlatform.log.error).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(expect.any(Error));
  });

  it('should handle an invalid option value when setting display mode', async () => {
    // Extract the handlers
    const { onSetHandler } = getHandlers();
    const callback = vi.fn();
    
    // Call onSet with an invalid value (normally not possible through HomeKit API)
    // @ts-ignore - deliberately passing invalid value for test
    await onSetHandler('invalid', callback);
    
    // Verify applyStateToDevice was called with correct parameters
    // Should convert non-boolean values to boolean appropriately
    expect(cacheManager.applyStateToDevice).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(null);
  });

  it('should test setApiState method with actual device state', async () => {
    // Extract the handlers
    const { onSetHandler } = getHandlers();
    const callback = vi.fn();
    
    // Create a uniquely identifiable deviceState and verify it's used
    const uniqueDeviceState = new MockDeviceState();
    vi.spyOn(cacheManager, 'getDeviceState').mockReturnValue(uniqueDeviceState);
    
    // Spy on the applyStateToDevice call
    vi.spyOn(cacheManager, 'applyStateToDevice');
    
    // Turn display on
    await onSetHandler(true, callback);
    
    // Verify that the correct state was passed to applyStateToDevice
    expect(cacheManager.applyStateToDevice).toHaveBeenCalled();
    const stateToApply = (cacheManager.applyStateToDevice as any).mock.calls[0][0];
    expect(stateToApply.displayMode).toBe(PowerState.On);
    
    // Turn display off
    await onSetHandler(false, callback);
    const stateToApply2 = (cacheManager.applyStateToDevice as any).mock.calls[1][0];
    expect(stateToApply2.displayMode).toBe(PowerState.Off);
  });

  // Add a test for direct access to handleGet with null status from toApiStatus
  it('should handle null return from toApiStatus in handleGet', () => {
    // Verify that the handleGet method exists on DisplaySwitchAccessory
    expect(typeof (displaySwitch as any).handleGet).toBe('function');
    
    // Mock deviceState.toApiStatus to return null
    vi.spyOn(cacheManager.deviceState, 'toApiStatus').mockReturnValue(null);
    
    // Call handleGet directly and verify it handles null status gracefully
    const result = (displaySwitch as any).handleGet();
    expect(result).toBe(false);
  });

  // Add test for missing opt_display property in getStatusValue callback
  it('should handle missing opt_display in returned status object', async () => {
    // Extract the original callback function passed to BaseSwitchAccessory
    const { onGetHandler } = getHandlers();
    
    // Mock toApiStatus to return an object missing opt_display
    vi.spyOn(cacheManager.deviceState, 'toApiStatus').mockReturnValue({
      // Return a status object without the opt_display property
      is_on: PowerState.On,
      operation_mode: 'auto'
    });
    
    // Verify that the handler correctly handles missing opt_display
    expect(await onGetHandler()).toBe(false);
  });

  it('should handle network timeout in applyStateToDevice', async () => {
    // Extract the handlers
    const { onSetHandler } = getHandlers();
    const callback = vi.fn();
    
    // Mock applyStateToDevice to immediately reject with a network error
    vi.spyOn(cacheManager, 'applyStateToDevice').mockRejectedValueOnce(new Error('Network timeout'));
    
    // Call onSet and verify error handling
    await onSetHandler(true, callback);
    
    // Verify error was logged
    expect(mockPlatform.log.error).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(expect.any(Error));
  }, 5000);
});
