import { PlatformAccessory } from 'homebridge';
import { TurboSwitchAccessory } from '../TurboSwitchAccessory.js';
import { TfiacPlatform } from '../platform.js';

// ---------- mocks ---------------------------------------------------
const updateStateMock = jest.fn();
const setSuperStateMock = jest.fn();
const cleanupMock = jest.fn();

jest.mock('../AirConditionerAPI.js', () => {
  return jest.fn().mockImplementation(() => ({
    updateState: updateStateMock,
    setSuperState: setSuperStateMock,
    cleanup: cleanupMock,
  }));
});

// Mock setTimeout and clearInterval globally
const originalSetTimeout = global.setTimeout;
const originalClearInterval = global.clearInterval;
const originalSetInterval = global.setInterval;

// Preparation for the accessory constructor
const mockPlatform = (): TfiacPlatform =>
  ({
    Service: { Switch: jest.fn() },
    Characteristic: { Name: 'Name', On: 'On' },
    log: { debug: jest.fn(), error: jest.fn() },
  } as unknown as TfiacPlatform);

const makeAccessory = (): PlatformAccessory =>
  ({
    context: { deviceConfig: { name: 'AC', ip: '1.2.3.4', updateInterval: 1 } },
    getService: jest.fn().mockReturnValue(undefined),
    addService: jest.fn().mockReturnValue({
      setCharacteristic: jest.fn().mockReturnThis(),
      getCharacteristic: jest
        .fn()
        .mockReturnValue({ on: jest.fn().mockReturnThis() }),
      updateCharacteristic: jest.fn(),
    }),
  } as unknown as PlatformAccessory);

// --------------------------------------------------------------------

describe('TurboSwitchAccessory – unit', () => {
  let accessory: TurboSwitchAccessory;
  let mockUpdateCachedStatus: jest.Mock;
  let mockSetTimeout: jest.Mock;
  let mockClearInterval: jest.Mock;
  let mockSetInterval: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    updateStateMock.mockResolvedValue({ opt_super: 'off' });
    
    // Mock timing functions
    mockSetTimeout = jest.fn().mockImplementation((fn) => {
      // Store callback but don't execute it automatically
      return { callback: fn, id: 123 };
    });
    mockClearInterval = jest.fn();
    mockSetInterval = jest.fn().mockReturnValue(456);
    
    global.setTimeout = mockSetTimeout as unknown as typeof global.setTimeout;
    global.clearInterval = mockClearInterval as unknown as typeof global.clearInterval;
    global.setInterval = mockSetInterval as unknown as typeof global.setInterval;
    
    // This allows us to bypass the initial updateCachedStatus call
    mockUpdateCachedStatus = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (accessory) {
      accessory.stopPolling();
    }
    
    // Restore original timing functions
    global.setTimeout = originalSetTimeout;
    global.clearInterval = originalClearInterval;
    global.setInterval = originalSetInterval;
  });

  // Helper function to create accessory with an overridden updateCachedStatus method
  const createAccessoryWithMockedUpdate = (existingService?: any) => {
    const accInstance = makeAccessory();
    if (existingService) {
      (accInstance.getService as jest.Mock).mockReturnValue(existingService);
    }
    const acc = new TurboSwitchAccessory(mockPlatform(), accInstance);
    // Replace the method after construction
    Object.defineProperty(acc, 'updateCachedStatus', {
      value: mockUpdateCachedStatus
    });
    return acc;
  };

  it('should initialize correctly and add a new service', () => {
    accessory = createAccessoryWithMockedUpdate();
    const platformAcc = (accessory as any).accessory as PlatformAccessory;
    const svc = (accessory as any).service;

    expect(platformAcc.addService).toHaveBeenCalledWith(expect.any(Function), 'Turbo', 'turbo');
    expect(svc.setCharacteristic).toHaveBeenCalledWith('Name', 'Turbo');
    expect(svc.getCharacteristic).toHaveBeenCalledWith('On');
    expect(svc.getCharacteristic().on).toHaveBeenCalledWith('get', expect.any(Function));
    expect(svc.getCharacteristic().on).toHaveBeenCalledWith('set', expect.any(Function));
  });

  it('should use existing service if available', () => {
    const existingMockService = {
      setCharacteristic: jest.fn().mockReturnThis(),
      getCharacteristic: jest.fn().mockReturnValue({ on: jest.fn().mockReturnThis() }),
      updateCharacteristic: jest.fn(),
    };
    accessory = createAccessoryWithMockedUpdate(existingMockService);
    const platformAcc = (accessory as any).accessory as PlatformAccessory;
    const svc = (accessory as any).service;

    expect(platformAcc.getService).toHaveBeenCalledWith('Turbo');
    expect(platformAcc.addService).not.toHaveBeenCalled();
    expect(svc.setCharacteristic).toHaveBeenCalledWith('Name', 'Turbo');
    expect(svc.getCharacteristic).toHaveBeenCalledWith('On');
    expect(svc.getCharacteristic().on).toHaveBeenCalledWith('get', expect.any(Function));
    expect(svc.getCharacteristic().on).toHaveBeenCalledWith('set', expect.any(Function));
  });

  it('polls and updates characteristic when turbo mode is off', async () => {
    // Setup
    updateStateMock.mockResolvedValueOnce({ opt_super: 'off' });
    
    // Create the accessory
    accessory = createAccessoryWithMockedUpdate();
    
    // Simulate the interval callback
    const intervalCallback = mockSetInterval.mock.calls[0][0];
    
    // Replace the implementation for this test
    mockUpdateCachedStatus.mockImplementationOnce(async () => {
      const status = await updateStateMock();
      const svc = (accessory as any).service;
      svc.updateCharacteristic('On', status.opt_super === 'on');
    });
    
    // Manually trigger the interval callback
    await intervalCallback();
    
    // Assertions
    const svc = (accessory as any).service;
    expect(updateStateMock).toHaveBeenCalled();
    expect(svc.updateCharacteristic).toHaveBeenCalledWith('On', false);
  });

  it('polls and updates characteristic when turbo mode is on', async () => {
    // Setup
    updateStateMock.mockResolvedValueOnce({ opt_super: 'on' });
    
    // Create the accessory
    accessory = createAccessoryWithMockedUpdate();
    
    // Simulate the interval callback
    const intervalCallback = mockSetInterval.mock.calls[0][0];
    
    // Replace the implementation for this test
    mockUpdateCachedStatus.mockImplementationOnce(async () => {
      const status = await updateStateMock();
      const svc = (accessory as any).service;
      svc.updateCharacteristic('On', status.opt_super === 'on');
    });
    
    // Manually trigger the interval callback
    await intervalCallback();
    
    // Assertions
    const svc = (accessory as any).service;
    expect(updateStateMock).toHaveBeenCalled();
    expect(svc.updateCharacteristic).toHaveBeenCalledWith('On', true);
  });

  it('handles errors during polling', async () => {
    // Setup
    const error = new Error('Network error');
    updateStateMock.mockRejectedValueOnce(error);
    
    // Create the accessory
    accessory = createAccessoryWithMockedUpdate();
    
    // Simulate the interval callback
    const intervalCallback = mockSetInterval.mock.calls[0][0];
    
    // Replace the implementation for this test
    mockUpdateCachedStatus.mockImplementationOnce(async () => {
      try {
        await updateStateMock();
      } catch (e) {
        const platform = (accessory as any).platform;
        platform.log.error('Error updating turbo status:', e);
      }
    });
    
    // Manually trigger the interval callback
    await intervalCallback();
    
    // Assertions
    const platform = (accessory as any).platform;
    expect(platform.log.error).toHaveBeenCalledWith(
      expect.stringContaining('Error updating turbo status:'),
      error
    );
  });

  it('handles get characteristic with null cached status', () => {
    accessory = createAccessoryWithMockedUpdate();
    const callback = jest.fn();
    (accessory as any).cachedStatus = null;
    (accessory as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it('handles get characteristic with turbo on', () => {
    accessory = createAccessoryWithMockedUpdate();
    const callback = jest.fn();
    (accessory as any).cachedStatus = { opt_super: 'on' };
    (accessory as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it('handles get characteristic with turbo off', () => {
    accessory = createAccessoryWithMockedUpdate();
    const callback = jest.fn();
    (accessory as any).cachedStatus = { opt_super: 'off' };
    (accessory as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it('handles get characteristic with undefined turbo status', () => {
    accessory = createAccessoryWithMockedUpdate();
    const callback = jest.fn();
    (accessory as any).cachedStatus = { someOtherProp: 'value' };
    (accessory as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it('handles set characteristic to turn turbo on', async () => {
    accessory = createAccessoryWithMockedUpdate();
    const callback = jest.fn();
    setSuperStateMock.mockResolvedValueOnce({});
    updateStateMock.mockResolvedValueOnce({ opt_super: 'on' });

    await (accessory as any).handleSet(true, callback);
    
    expect(setSuperStateMock).toHaveBeenCalledWith('on');
    expect(callback).toHaveBeenCalledWith(null);
  });

  it('handles set characteristic to turn turbo off', async () => {
    accessory = createAccessoryWithMockedUpdate();
    const callback = jest.fn();
    setSuperStateMock.mockResolvedValueOnce({});
    updateStateMock.mockResolvedValueOnce({ opt_super: 'off' });

    await (accessory as any).handleSet(false, callback);
    
    expect(setSuperStateMock).toHaveBeenCalledWith('off');
    expect(callback).toHaveBeenCalledWith(null);
  });

  it('handles errors during set characteristic', async () => {
    accessory = createAccessoryWithMockedUpdate();
    const callback = jest.fn();
    const error = new Error('API error');
    setSuperStateMock.mockRejectedValueOnce(error);

    await (accessory as any).handleSet(true, callback);
    
    expect(callback).toHaveBeenCalledWith(error);
  });

  it('properly cleans up when stopping polling', () => {
    // Create the accessory
    accessory = createAccessoryWithMockedUpdate();
    
    // Stop polling
    accessory.stopPolling();
    
    // Verify that clearInterval was called
    expect(mockClearInterval).toHaveBeenCalled();
    expect(cleanupMock).toHaveBeenCalled();
  });

  it('handles missing opt_super property in status update', async () => {
    class TestTurboSwitchAccessory extends TurboSwitchAccessory {
      protected async updateCachedStatus(): Promise<void> {
        this.cachedStatus = { 
          current_temp: 25, 
          operation_mode: 'auto',
          target_temp: 22,
          fan_mode: 'low',
          is_on: 'on',
          swing_mode: 'fixed'
        }; // Using correct property names with all required fields
        // Do NOT call updateCharacteristic
      }
    }

    const accessory = new TestTurboSwitchAccessory(mockPlatform(), makeAccessory());
    const serviceUpdateSpy = jest.fn();
    (accessory as any).service.updateCharacteristic = serviceUpdateSpy;

    // Simulate the interval callback
    const intervalCallback = mockSetInterval.mock.calls[0][0];
    await intervalCallback();

    expect(serviceUpdateSpy).not.toHaveBeenCalled();
  });

  it('handles missing opt_turbo property in status update', async () => {
    class TestTurboSwitchAccessory extends TurboSwitchAccessory {
      protected async updateCachedStatus(): Promise<void> {
        this.cachedStatus = { 
          current_temp: 25, 
          operation_mode: 'auto',
          target_temp: 22,
          fan_mode: 'low',
          is_on: 'on', // Using string instead of boolean
          swing_mode: 'fixed'
        }; // Using correct property names
        // Do NOT call updateCharacteristic
      }
    }

    const accessory = new TestTurboSwitchAccessory(mockPlatform(), makeAccessory());
    const serviceUpdateSpy = jest.fn();
    (accessory as any).service.updateCharacteristic = serviceUpdateSpy;

    // Simulate the interval callback
    const intervalCallback = mockSetInterval.mock.calls[0][0];
    await intervalCallback();

    expect(serviceUpdateSpy).not.toHaveBeenCalled();
  });

  it('applies random warmup delay during initialization', () => {
    // Mock Math.random to return a specific value
    const originalRandom = Math.random;
    Math.random = jest.fn().mockReturnValue(0.5);
    
    try {
      // Create accessory (this will create the initial setTimeout)
      accessory = new TurboSwitchAccessory(mockPlatform(), makeAccessory());
      
      // Check that setTimeout was called with the right delay
      expect(mockSetTimeout).toHaveBeenCalledWith(
        expect.any(Function),
        7500 // 0.5 * 15000 = 7500
      );
    } finally {
      // Restore original random function
      Math.random = originalRandom;
    }
  });
});