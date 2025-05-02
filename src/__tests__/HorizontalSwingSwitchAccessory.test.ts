import { HorizontalSwingSwitchAccessory } from '../HorizontalSwingSwitchAccessory.js';
import { TfiacPlatform } from '../platform.js';
import { PlatformAccessory, Service } from 'homebridge';
import { 
  setupTestPlatform, 
  createMockPlatformAccessory, 
  createMockService
} from './testUtils.js';

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
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let service: Service;
  let inst: HorizontalSwingSwitchAccessory; // Instance tracker

  beforeEach(() => {
    jest.clearAllMocks(); // Clear all mocks
    platform = setupTestPlatform();
    service = createMockService();

    // Always return the same mock service for addService/getService
    accessory = createMockPlatformAccessory();
    (accessory.getService as jest.Mock).mockReturnValue(service);
    (accessory.addService as jest.Mock).mockReturnValue(service);
    // By default, getServiceById returns undefined to allow addService to be called
    (accessory.getServiceById as jest.Mock).mockReturnValue(undefined);

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
    // Depending on whether the service already existed, the accessory will either
    // retrieve it or create a new one. Assert accordingly.
    if ((accessory.addService as jest.Mock).mock.calls.length > 0) {
      expect(accessory.addService).toHaveBeenCalledWith(
        expect.anything(),
        'Horizontal Swing',
        'horizontal_swing',
      );
    } else {
      expect(accessory.getService).toHaveBeenCalledWith('Horizontal Swing');
    }

    // ConfiguredName should always be set
    expect(service.setCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.ConfiguredName,
      'Horizontal Swing',
    );
    expect(service.getCharacteristic).toHaveBeenCalledWith('On');
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
    const mockCacheManager = (inst as any).cacheManager;
    mockCacheManager.getStatus = jest.fn().mockResolvedValue({ swing_mode: 'Horizontal' });
    (service.updateCharacteristic as jest.Mock).mockClear();
    await (inst as any).updateCachedStatus();
    expect(mockCacheManager.getStatus).toHaveBeenCalled();
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', true);
  });

  it('should update cached status and update characteristic for Both mode', async () => {
    createAccessory();
    const mockCacheManager = (inst as any).cacheManager;
    mockCacheManager.getStatus = jest.fn().mockResolvedValue({ swing_mode: 'Both' });
    (service.updateCharacteristic as jest.Mock).mockClear();
    await (inst as any).updateCachedStatus();
    expect(mockCacheManager.getStatus).toHaveBeenCalled();
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', true);
  });

  it('should not update characteristic when cached and new status both Off', async () => {
    createAccessory();
    const mockCacheManager = (inst as any).cacheManager;
    mockCacheManager.getStatus = jest.fn().mockResolvedValue({ swing_mode: 'Off' });
    (service.updateCharacteristic as jest.Mock).mockClear();
    await (inst as any).updateCachedStatus();
    expect(mockCacheManager.getStatus).toHaveBeenCalled();
    expect(service.updateCharacteristic).not.toHaveBeenCalled();
  });

  it('should not update characteristic when cached and new status both Vertical', async () => {
    createAccessory();
    const mockCacheManager = (inst as any).cacheManager;
    mockCacheManager.getStatus = jest.fn().mockResolvedValue({ swing_mode: 'Vertical' });
    (service.updateCharacteristic as jest.Mock).mockClear();
    await (inst as any).updateCachedStatus();
    expect(mockCacheManager.getStatus).toHaveBeenCalled();
    expect(service.updateCharacteristic).not.toHaveBeenCalled();
  });

  it('should handle error during update cached status', async () => {
    createAccessory();
    const mockCacheManager = (inst as any).cacheManager;
    const error = new Error('Network error');
    mockCacheManager.getStatus = jest.fn().mockRejectedValue(error);
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
      expect(err).toBeNull();
      expect(val).toBe(false);
      done();
    });
  });

  it('should handle set ON when vertical is OFF', async () => {
    createAccessory();
    (inst as any).cachedStatus = { swing_mode: 'Off' };
    const cb = jest.fn();
    updateStateMock.mockResolvedValueOnce({ swing_mode: 'Horizontal' });
    await (inst as any).handleSet(true, cb);
    expect(setSwingModeMock).toHaveBeenCalledWith('Horizontal');
    expect(cb).toHaveBeenCalledWith(null);
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', true);
  });

  it('should handle set ON when vertical is ON', async () => {
    createAccessory();
    (inst as any).cachedStatus = { swing_mode: 'Vertical' };
    const cb = jest.fn();
    updateStateMock.mockResolvedValueOnce({ swing_mode: 'Both' });
    await (inst as any).handleSet(true, cb);
    expect(setSwingModeMock).toHaveBeenCalledWith('Both');
    expect(cb).toHaveBeenCalledWith(null);
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', true);
  });

  it('should handle set OFF when both are ON', async () => {
    createAccessory();
    (inst as any).cachedStatus = { swing_mode: 'Both' };
    const cb = jest.fn();
    updateStateMock.mockResolvedValueOnce({ swing_mode: 'Vertical' });
    await (inst as any).handleSet(false, cb);
    expect(setSwingModeMock).toHaveBeenCalledWith('Vertical');
    expect(cb).toHaveBeenCalledWith(null);
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', false);
  });

  it('should handle set OFF when only horizontal is ON', async () => {
    createAccessory();
    (inst as any).cachedStatus = { swing_mode: 'Horizontal' };
    const cb = jest.fn();
    updateStateMock.mockResolvedValueOnce({ swing_mode: 'Off' });
    await (inst as any).handleSet(false, cb);
    expect(setSwingModeMock).toHaveBeenCalledWith('Off');
    expect(cb).toHaveBeenCalledWith(null);
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', false);
  });

  it('should handle set error', async () => {
    createAccessory();
    const error = new Error('Network error');
    setSwingModeMock.mockRejectedValueOnce(error);
    const cb = jest.fn();
    await (inst as any).handleSet(true, cb);
    expect(cb).toHaveBeenCalledWith(error);
  });
});