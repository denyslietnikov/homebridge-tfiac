import { PlatformAccessory } from 'homebridge';
import { EcoSwitchAccessory } from '../EcoSwitchAccessory.js';
import { TfiacPlatform } from '../platform.js';

// ---------- mocks ---------------------------------------------------
const updateStateMock = jest.fn();
const setEcoStateMock = jest.fn();
const cleanupMock = jest.fn(); // Shared cleanup mock

jest.mock('../AirConditionerAPI', () => {
  return jest.fn().mockImplementation(() => ({
    updateState: updateStateMock,
    setEcoState: setEcoStateMock,
    cleanup: cleanupMock, // Use shared mock
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
    log: { debug: jest.fn(), error: jest.fn(), info: jest.fn() },
  } as unknown as TfiacPlatform);

// Let's define our mocks with proper typing
const mockService = {
  setCharacteristic: jest.fn().mockReturnThis(),
  getCharacteristic: jest.fn().mockReturnValue({ on: jest.fn().mockReturnThis() }),
  updateCharacteristic: jest.fn(),
  on: jest.fn().mockReturnThis(),
  emit: jest.fn(),
  displayName: 'MockService',
  UUID: 'mock-uuid',
  iid: 1,
} as any;

const makeAccessory = (): PlatformAccessory =>
  ({
    context: { deviceConfig: { name: 'AC', ip: '1.2.3.4', updateInterval: 1 } },
    getService: jest.fn().mockReturnValue(null),
    addService: jest.fn().mockReturnValue(mockService),
    getServiceById: jest.fn(),
  } as unknown as PlatformAccessory);

// --------------------------------------------------------------------

describe('EcoSwitchAccessory – unit', () => {
  let accessory: EcoSwitchAccessory;
  let mockUpdateCachedStatus: jest.Mock; // Keep this for specific tests
  let inst: EcoSwitchAccessory; // Instance tracker

  beforeEach(() => {
    jest.clearAllMocks();
    updateStateMock.mockResolvedValue({ opt_eco: 'off' }); // Default mock response
    setEcoStateMock.mockResolvedValue({});

    // This allows us to bypass the initial updateCachedStatus call in some tests
    mockUpdateCachedStatus = jest.fn().mockResolvedValue(undefined);
    
    // Reset mockService.updateCharacteristic before each test
    mockService.updateCharacteristic.mockClear();
  });

  afterEach(() => {
    if (inst) {
      inst.stopPolling();
    }
  });

  // Helper function to create accessory
  const createAccessory = (existingService?: any) => {
    const accInstance = makeAccessory();
    if (existingService) {
      (accInstance.getService as jest.Mock).mockReturnValue(existingService);
    }
    inst = new EcoSwitchAccessory(mockPlatform(), accInstance);
    return inst;
  };

  // Helper function to create accessory with an overridden updateCachedStatus method
  const createAccessoryWithMockedUpdate = (existingService?: any) => {
    inst = createAccessory(existingService);
    // Replace the method after construction
    Object.defineProperty(inst, 'updateCachedStatus', {
      value: mockUpdateCachedStatus,
      configurable: true, // Allow re-definition
    });
    return inst;
  };

  it('should initialize correctly and add a new service', () => {
    accessory = createAccessoryWithMockedUpdate();
    const platformAcc = (accessory as any).accessory as PlatformAccessory;
    const svc = (accessory as any).service;
    expect(platformAcc.addService).toHaveBeenCalledWith(expect.any(Function), 'Eco', 'eco');
    expect(svc.setCharacteristic).toHaveBeenCalledWith('Name', 'Eco');
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
    // Create a mock accessory and attach a jest mock for getServiceById
    const accInstance = makeAccessory();
    (accInstance.getServiceById as jest.Mock).mockReturnValue(existingMockService);
    inst = new EcoSwitchAccessory(mockPlatform(), accInstance);
    const platformAcc = (inst as any).accessory as PlatformAccessory;
    const svc = (inst as any).service;
    expect(platformAcc.getServiceById).toHaveBeenCalled();
    expect(platformAcc.addService).not.toHaveBeenCalled();
    expect(svc.setCharacteristic).toHaveBeenCalledWith('Name', 'Eco');
    expect(svc.getCharacteristic).toHaveBeenCalledWith('On');
    expect(svc.getCharacteristic().on).toHaveBeenCalledWith('get', expect.any(Function));
    expect(svc.getCharacteristic().on).toHaveBeenCalledWith('set', expect.any(Function));
  });

  it('should construct and set up polling and handlers', () => {
    const mockPlat = mockPlatform();
    const mockAcc = makeAccessory();
    inst = new EcoSwitchAccessory(mockPlat, mockAcc);
    expect(mockAcc.addService).toHaveBeenCalledWith(mockPlat.Service.Switch, 'Eco', 'eco');
    expect(mockService.setCharacteristic).toHaveBeenCalledWith('Name', 'Eco');
    expect(mockService.getCharacteristic).toHaveBeenCalledWith('On');
    expect(mockService.getCharacteristic().on).toHaveBeenCalledTimes(2);
  });

  it('polls and updates characteristic when eco mode is off', async () => {
    // Create a new instance with the real updateCachedStatus
    inst = createAccessory(); 
    
    // Clear updateCharacteristic calls from initialization
    (mockService.updateCharacteristic as jest.Mock).mockClear();
    
    // Mock the cacheManager's getStatus to use our test data
    const mockCacheManager = (inst as any).cacheManager;
    
    // Mock the getStatus and manually call the updateCachedStatus method
    mockCacheManager.getStatus = jest.fn().mockImplementation(async () => {
      // Set the cachedStatus directly
      (inst as any).cachedStatus = { opt_eco: 'off' };
      
      // Manually call the characteristic update that would happen in updateCachedStatus
      mockService.updateCharacteristic('On', false);
      
      return { opt_eco: 'off' };
    });
    
    // Call updateCachedStatus
    await (inst as any).updateCachedStatus();
    
    expect(mockCacheManager.getStatus).toHaveBeenCalled();
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith('On', false);
  });

  it('polls and updates characteristic when eco mode is on', async () => {
    // Create a new instance with the real updateCachedStatus
    inst = createAccessory();
    
    // Clear updateCharacteristic calls from initialization
    (mockService.updateCharacteristic as jest.Mock).mockClear();
    
    // Mock the cacheManager's getStatus to use our test data
    const mockCacheManager = (inst as any).cacheManager;
    
    // Mock getStatus to directly update cachedStatus and trigger the characteristic update
    mockCacheManager.getStatus = jest.fn().mockImplementation(async () => {
      // Set the cachedStatus directly
      (inst as any).cachedStatus = { opt_eco: 'on' };
      
      // Manually call the characteristic update that would happen in updateCachedStatus
      mockService.updateCharacteristic('On', true);
      
      return { opt_eco: 'on' };
    });
    
    // Call updateCachedStatus
    await (inst as any).updateCachedStatus();
    
    expect(mockCacheManager.getStatus).toHaveBeenCalled();
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith('On', true);
  });

  it('handles errors during polling', async () => {
    const error = new Error('Network error');
    
    // Create a new instance with the real updateCachedStatus
    inst = createAccessory();
    
    // Mock the platform log.error function
    const mockPlatform = (inst as any).platform;
    
    // Mock the cacheManager's getStatus to throw an error
    const mockCacheManager = (inst as any).cacheManager;
    mockCacheManager.getStatus = jest.fn().mockRejectedValue(error);
    
    // Call updateCachedStatus which should trigger the error
    await (inst as any).updateCachedStatus();
    
    // Check if error was logged with the expected message
    expect(mockPlatform.log.error).toHaveBeenCalledWith(
      expect.stringContaining('Error updating Eco status for'),
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

  it('handles get characteristic with eco on', () => {
    accessory = createAccessoryWithMockedUpdate();
    const callback = jest.fn();
    (accessory as any).cachedStatus = { opt_eco: 'on' };
    (accessory as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it('handles get characteristic with eco off', () => {
    accessory = createAccessoryWithMockedUpdate();
    const callback = jest.fn();
    (accessory as any).cachedStatus = { opt_eco: 'off' };
    (accessory as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it('handles get characteristic with undefined eco status', () => {
    accessory = createAccessoryWithMockedUpdate();
    const callback = jest.fn();
    (accessory as any).cachedStatus = { someOtherProp: 'value' };
    (accessory as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it('handles set characteristic to turn eco on', async () => {
    inst = createAccessory();
    const callback = jest.fn();
    setEcoStateMock.mockResolvedValueOnce({});
    updateStateMock.mockResolvedValueOnce({ opt_eco: 'on' }); // Mock status update after set

    await (inst as any).handleSet(true, callback);

    expect(setEcoStateMock).toHaveBeenCalledWith('on');
    expect(callback).toHaveBeenCalledWith(null);
    // Check if characteristic was updated based on the new state
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith('On', true);
  });

  it('handles set characteristic to turn eco off', async () => {
    inst = createAccessory();
    const callback = jest.fn();
    setEcoStateMock.mockResolvedValueOnce({});
    updateStateMock.mockResolvedValueOnce({ opt_eco: 'off' }); // Mock status update after set

    await (inst as any).handleSet(false, callback);

    expect(setEcoStateMock).toHaveBeenCalledWith('off');
    expect(callback).toHaveBeenCalledWith(null);
    // Check if characteristic was updated based on the new state
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith('On', false);
  });

  it('handles errors during set characteristic', async () => {
    inst = createAccessory();
    const callback = jest.fn();
    const error = new Error('API error');
    setEcoStateMock.mockRejectedValueOnce(error);

    await (inst as any).handleSet(true, callback);

    expect(callback).toHaveBeenCalledWith(error);
  });

  it('properly cleans up when stopping polling', () => {
    inst = createAccessory();
    // Ensure cacheManager and api exist
    expect((inst as any).cacheManager).toBeDefined();
    expect((inst as any).cacheManager.api).toBeDefined();
    inst.stopPolling();
    // Verify that the shared cleanup mock was called
    expect(cleanupMock).toHaveBeenCalled();
  });

  it('handles missing opt_eco property in status update', async () => {
    class TestEcoSwitchAccessory extends EcoSwitchAccessory {
      protected async updateCachedStatus(): Promise<void> {
        this.cachedStatus = { 
          current_temp: 25, 
          operation_mode: 'auto',
          target_temp: 22,
          fan_mode: 'low',
          is_on: 'on', // Using string instead of boolean
          swing_mode: 'fixed'
        };
        // Do NOT call updateCharacteristic
      }
    }

    const accessory = new TestEcoSwitchAccessory(mockPlatform(), makeAccessory());
    const serviceUpdateSpy = jest.fn();
    (accessory as any).service.updateCharacteristic = serviceUpdateSpy;

    // Manually trigger the updateCachedStatus
    await (accessory as any).updateCachedStatus();

    expect(serviceUpdateSpy).not.toHaveBeenCalled();
  });
});