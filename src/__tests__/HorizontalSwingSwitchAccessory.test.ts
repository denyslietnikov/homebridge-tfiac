import { HorizontalSwingSwitchAccessory } from '../HorizontalSwingSwitchAccessory.js';
import { TfiacPlatform } from '../platform.js';
import { PlatformAccessory, Service } from 'homebridge';

// Define mocks at the top level
const updateStateMock = jest.fn();
const setSwingModeMock = jest.fn();
const cleanupMock = jest.fn(); // Shared cleanup mock

jest.mock('../AirConditionerAPI.js', () => {
  return jest.fn().mockImplementation(() => ({
    updateState: updateStateMock,
    setSwingMode: setSwingModeMock,
    cleanup: cleanupMock, // Use shared mock
  }));
});

describe('HorizontalSwingSwitchAccessory', () => {
  const mockService: any = {
    setCharacteristic: jest.fn().mockReturnThis(),
    getCharacteristic: jest.fn().mockReturnValue({ on: jest.fn().mockReturnThis() }),
    updateCharacteristic: jest.fn(),
    on: jest.fn().mockReturnThis(),
    emit: jest.fn(),
    displayName: 'MockService',
    UUID: 'mock-uuid',
    iid: 1,
  };

  const makeAccessory = (): PlatformAccessory =>
    ({
      context: { deviceConfig: { name: 'AC', ip: '1.2.3.4', updateInterval: 1 } },
      getService: jest.fn().mockReturnValue(null),
      addService: jest.fn().mockReturnValue(mockService),
      getServiceById: jest.fn(),
    } as unknown as PlatformAccessory);

  const mockPlatform = (): TfiacPlatform =>
    ({
      Service: { Switch: jest.fn() },
      Characteristic: { Name: 'Name', On: 'On' },
      log: { debug: jest.fn(), error: jest.fn(), info: jest.fn() },
    } as unknown as TfiacPlatform);

  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let service: Service;
  let inst: HorizontalSwingSwitchAccessory; // Instance tracker

  beforeEach(() => {
    jest.clearAllMocks(); // Clear all mocks
    platform = mockPlatform();
    service = mockService;
    accessory = makeAccessory();
    // Set default mock responses
    updateStateMock.mockResolvedValue({ swing_mode: 'Horizontal' });
    setSwingModeMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (inst) {
      inst.stopPolling(); // Ensure polling stops
    }
  });

  const createAccessory = () => {
    inst = new HorizontalSwingSwitchAccessory(platform, accessory);
    return inst;
  };

  it('should construct and set up polling and handlers', () => {
    createAccessory();
    expect(accessory.addService).toHaveBeenCalledWith(platform.Service.Switch, 'Horizontal Swing', 'horizontalswing');
    expect(service.setCharacteristic).toHaveBeenCalledWith('Name', 'Horizontal Swing');
    expect(service.getCharacteristic).toHaveBeenCalledWith('On');
    // Update expectations to match how event handlers are now registered
    const mockCharacteristic = service.getCharacteristic('On');
    expect(mockCharacteristic?.on).toHaveBeenCalledWith('get', expect.any(Function));
    expect(mockCharacteristic?.on).toHaveBeenCalledWith('set', expect.any(Function));
  });

  it('should stop polling and cleanup', () => {
    createAccessory();
    // Ensure cacheManager and api exist
    expect((inst as any).cacheManager).toBeDefined();
    expect((inst as any).cacheManager.api).toBeDefined();
    inst.stopPolling();
    // Assert the shared cleanupMock
    expect(cleanupMock).toHaveBeenCalled();
  });

  it('should update cached status and update characteristic for Horizontal mode', async () => {
    createAccessory();
    // Mock the cacheManager's getStatus to use our mocked value
    const mockCacheManager = (inst as any).cacheManager;
    mockCacheManager.getStatus = jest.fn().mockResolvedValue({ swing_mode: 'Horizontal' });
    
    // Clear existing mock calls - use type assertion to fix TypeScript error
    (service.updateCharacteristic as jest.Mock).mockClear();
    
    await (inst as any).updateCachedStatus();
    expect(mockCacheManager.getStatus).toHaveBeenCalled();
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', true);
  });

  it('should update cached status and update characteristic for Both mode', async () => {
    createAccessory();
    // Mock the cacheManager's getStatus to use our mocked value
    const mockCacheManager = (inst as any).cacheManager;
    mockCacheManager.getStatus = jest.fn().mockResolvedValue({ swing_mode: 'Both' });
    
    // Clear existing mock calls - use type assertion to fix TypeScript error
    (service.updateCharacteristic as jest.Mock).mockClear();
    
    await (inst as any).updateCachedStatus();
    expect(mockCacheManager.getStatus).toHaveBeenCalled();
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', true);
  });

  it('should update cached status and update characteristic for Off mode', async () => {
    createAccessory();
    // Mock the cacheManager's getStatus to use our mocked value
    const mockCacheManager = (inst as any).cacheManager;
    mockCacheManager.getStatus = jest.fn().mockResolvedValue({ swing_mode: 'Off' });
    
    // Clear existing mock calls - use type assertion to fix TypeScript error
    (service.updateCharacteristic as jest.Mock).mockClear();
    
    await (inst as any).updateCachedStatus();
    expect(mockCacheManager.getStatus).toHaveBeenCalled();
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', false);
  });

  it('should update cached status and update characteristic for Vertical mode', async () => {
    createAccessory();
    // Mock the cacheManager's getStatus to use our mocked value
    const mockCacheManager = (inst as any).cacheManager;
    mockCacheManager.getStatus = jest.fn().mockResolvedValue({ swing_mode: 'Vertical' });
    
    // Clear existing mock calls - use type assertion to fix TypeScript error
    (service.updateCharacteristic as jest.Mock).mockClear();
    
    await (inst as any).updateCachedStatus();
    expect(mockCacheManager.getStatus).toHaveBeenCalled();
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', false);
  });

  it('should handle error during update cached status', async () => {
    createAccessory();
    // Mock the cacheManager's getStatus to throw an error
    const mockCacheManager = (inst as any).cacheManager;
    const error = new Error('Network error');
    mockCacheManager.getStatus = jest.fn().mockRejectedValue(error);
    
    // Clear existing mock calls - use type assertion to fix TypeScript error
    (platform.log.error as jest.Mock).mockClear();
    
    await (inst as any).updateCachedStatus();
    expect(platform.log.error).toHaveBeenCalledWith(
      expect.stringContaining('Error updating Horizontal Swing status for'),
      error
    );
  });

  it('should handle get with cached status for Horizontal mode', done => {
    createAccessory();
    (inst as any).cachedStatus = { swing_mode: 'Horizontal' };
    (inst as any).handleGet((err: any, val: any) => {
      expect(err).toBeNull();
      expect(val).toBe(true);
      done();
    });
  });

  it('should handle get with cached status for Both mode', done => {
    createAccessory();
    (inst as any).cachedStatus = { swing_mode: 'Both' };
    (inst as any).handleGet((err: any, val: any) => {
      expect(err).toBeNull();
      expect(val).toBe(true);
      done();
    });
  });

  it('should handle get with cached status for Off mode', done => {
    createAccessory();
    (inst as any).cachedStatus = { swing_mode: 'Off' };
    (inst as any).handleGet((err: any, val: any) => {
      expect(err).toBeNull();
      expect(val).toBe(false);
      done();
    });
  });

  it('should handle get with cached status for Vertical mode', done => {
    createAccessory();
    (inst as any).cachedStatus = { swing_mode: 'Vertical' };
    (inst as any).handleGet((err: any, val: any) => {
      expect(err).toBeNull();
      expect(val).toBe(false);
      done();
    });
  });

  it('should handle get with no cached status', done => {
    createAccessory();
    (inst as any).cachedStatus = null;
    (inst as any).handleGet((err: any, val: any) => {
      // Now expecting default value (false) instead of error
      expect(err).toBeNull();
      expect(val).toBe(false);
      done();
    });
  });

  it('should handle set ON when vertical is OFF', async () => {
    createAccessory();
    (inst as any).cachedStatus = { swing_mode: 'Off' };
    const cb = jest.fn();
    updateStateMock.mockResolvedValueOnce({ swing_mode: 'Horizontal' }); // Mock status update after set
    await (inst as any).handleSet(true, cb);
    expect(setSwingModeMock).toHaveBeenCalledWith('Horizontal');
    expect(cb).toHaveBeenCalledWith(null);
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', true);
  });

  it('should handle set ON when vertical is ON', async () => {
    createAccessory();
    (inst as any).cachedStatus = { swing_mode: 'Vertical' };
    const cb = jest.fn();
    updateStateMock.mockResolvedValueOnce({ swing_mode: 'Both' }); // Mock status update after set
    await (inst as any).handleSet(true, cb);
    expect(setSwingModeMock).toHaveBeenCalledWith('Both');
    expect(cb).toHaveBeenCalledWith(null);
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', true);
  });

  it('should handle set OFF when both are ON', async () => {
    createAccessory();
    (inst as any).cachedStatus = { swing_mode: 'Both' };
    const cb = jest.fn();
    updateStateMock.mockResolvedValueOnce({ swing_mode: 'Vertical' }); // Mock status update after set
    await (inst as any).handleSet(false, cb);
    expect(setSwingModeMock).toHaveBeenCalledWith('Vertical');
    expect(cb).toHaveBeenCalledWith(null);
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', false);
  });

  it('should handle set OFF when only horizontal is ON', async () => {
    createAccessory();
    (inst as any).cachedStatus = { swing_mode: 'Horizontal' };
    const cb = jest.fn();
    updateStateMock.mockResolvedValueOnce({ swing_mode: 'Off' }); // Mock status update after set
    await (inst as any).handleSet(false, cb);
    expect(setSwingModeMock).toHaveBeenCalledWith('Off');
    expect(cb).toHaveBeenCalledWith(null);
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', false);
  });

  it('should handle set error', async () => {
    createAccessory();
    const error = new Error('Network error'); // Match the error message used in the test
    setSwingModeMock.mockRejectedValueOnce(error);
    const cb = jest.fn();
    await (inst as any).handleSet(true, cb);
    expect(cb).toHaveBeenCalledWith(error);
  });
});