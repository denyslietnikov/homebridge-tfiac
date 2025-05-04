import { HorizontalSwingSwitchAccessory } from '../HorizontalSwingSwitchAccessory.js';
import { TfiacPlatform } from '../platform.js';
import { PlatformAccessory, Service, CharacteristicGetCallback, CharacteristicSetCallback, CharacteristicValue } from 'homebridge';
import { 
  setupTestPlatform, 
  createMockPlatformAccessory, 
  createMockService
} from './testUtils.js';
import { vi, it, expect, describe, beforeEach, afterEach } from 'vitest';
import { SwingMode } from '../enums.js';
import type { AirConditionerStatus } from '../AirConditionerAPI.js';

// Define mocks at the top level
const updateStateMock = vi.fn();
const setSwingModeMock = vi.fn();
const cleanupMock = vi.fn(); // Shared cleanup mock

const mockApiActions = {
  updateState: updateStateMock,
  setSwingMode: setSwingModeMock,
  cleanup: cleanupMock, // Use shared mock
};

vi.mock('../AirConditionerAPI.js', () => ({
  default: vi.fn(() => mockApiActions)
}));

describe('HorizontalSwingSwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let service: Service;
  let inst: HorizontalSwingSwitchAccessory; // Instance tracker

  beforeEach(() => {
    vi.clearAllMocks(); // Clear all mocks
    platform = setupTestPlatform();
    service = createMockService();

    // Always return the same mock service for addService/getService
    accessory = createMockPlatformAccessory();
    (accessory.getService as ReturnType<typeof vi.fn>).mockReturnValue(service);
    (accessory.addService as ReturnType<typeof vi.fn>).mockReturnValue(service);
    // By default, getServiceById returns undefined to allow addService to be called
    (accessory.getServiceById as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

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
    if ((accessory.addService as ReturnType<typeof vi.fn>).mock.calls.length > 0) {
      expect(accessory.addService).toHaveBeenCalledWith(
        expect.anything(),
        'Horizontal Swing',
        'horizontal_swing',
      );
    } else {
      expect(accessory.getService).toHaveBeenCalledWith('Horizontal Swing');
    }

    // ConfiguredName and Name should always be set
    expect(service.setCharacteristic).toHaveBeenCalledWith(
      expect.objectContaining({ UUID: 'Name' }),
      'Horizontal Swing',
    );
    
    expect(service.getCharacteristic).toHaveBeenCalledWith('On');
    const mockCharacteristic = service.getCharacteristic('On');
    expect(mockCharacteristic?.onGet).toHaveBeenCalledWith(expect.any(Function));
    expect(mockCharacteristic?.onSet).toHaveBeenCalledWith(expect.any(Function));
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
    const mockCacheManager = { getStatus: vi.fn(), api: { on: vi.fn(), off: vi.fn() }, clear: vi.fn() };
    (inst as any).cacheManager = mockCacheManager;
    mockCacheManager.getStatus.mockResolvedValue({ swing_mode: 'Horizontal' });
    await (inst as any).updateCachedStatus();
    expect(mockCacheManager.getStatus).toHaveBeenCalled();
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', true);
  });

  it('should update cached status and update characteristic for Both mode', async () => {
    createAccessory();
    const mockCacheManager = { getStatus: vi.fn(), api: { on: vi.fn(), off: vi.fn() }, clear: vi.fn() };
    (inst as any).cacheManager = mockCacheManager;
    mockCacheManager.getStatus.mockResolvedValue({ swing_mode: 'Both' });
    await (inst as any).updateCachedStatus();
    expect(mockCacheManager.getStatus).toHaveBeenCalled();
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', true);
  });

  it('should not update characteristic when cached and new status both Off', async () => {
    createAccessory();
    const mockCacheManager = { getStatus: vi.fn(), api: { on: vi.fn(), off: vi.fn() }, clear: vi.fn() };
    (inst as any).cacheManager = mockCacheManager;
    mockCacheManager.getStatus.mockResolvedValue({ swing_mode: 'Off' });
    await (inst as any).updateCachedStatus();
    expect(mockCacheManager.getStatus).toHaveBeenCalled();
    expect(service.updateCharacteristic).not.toHaveBeenCalled();
  });

  it('should not update characteristic when cached and new status both Vertical', async () => {
    createAccessory();
    const mockCacheManager = { getStatus: vi.fn(), api: { on: vi.fn(), off: vi.fn() }, clear: vi.fn() };
    (inst as any).cacheManager = mockCacheManager;
    mockCacheManager.getStatus.mockResolvedValue({ swing_mode: 'Vertical' });
    await (inst as any).updateCachedStatus();
    expect(mockCacheManager.getStatus).toHaveBeenCalled();
    expect(service.updateCharacteristic).not.toHaveBeenCalled();
  });

  it('should handle error during update cached status', async () => {
    createAccessory();
    const mockCacheManager = { getStatus: vi.fn(), api: { on: vi.fn(), off: vi.fn() }, clear: vi.fn() };
    (inst as any).cacheManager = mockCacheManager;
    const error = new Error('Network error');
    mockCacheManager.getStatus.mockRejectedValue(error);
    await (inst as any).updateCachedStatus();
    expect(platform.log.error).toHaveBeenCalledWith(
      expect.stringContaining('Error updating Horizontal Swing status for'),
      error
    );
  });

  it('should handle get with cached status for Horizontal mode', async () => {
    createAccessory();
    (inst as any).cachedStatus = { swing_mode: 'Horizontal' };
    const result = await new Promise((resolve) => {
      (inst as any).handleGet((err: any, val: any) => {
        resolve({ err, val });
      });
    });
    const castedResult = result as { err: any, val: any };
    expect(castedResult.err).toBeNull();
    expect(castedResult.val).toBe(true);
  });

  it('should handle get with cached status for Both mode', async () => {
    createAccessory();
    (inst as any).cachedStatus = { swing_mode: 'Both' };
    const result = await new Promise((resolve) => {
      (inst as any).handleGet((err: any, val: any) => {
        resolve({ err, val });
      });
    });
    const castedResult = result as { err: any, val: any };
    expect(castedResult.err).toBeNull();
    expect(castedResult.val).toBe(true);
  });

  it('should handle get with cached status for Off mode', async () => {
    createAccessory();
    (inst as any).cachedStatus = { swing_mode: 'Off' };
    const result = await new Promise((resolve) => {
      (inst as any).handleGet((err: any, val: any) => {
        resolve({ err, val });
      });
    });
    const castedResult = result as { err: any, val: any };
    expect(castedResult.err).toBeNull();
    expect(castedResult.val).toBe(false);
  });

  it('should handle get with cached status for Vertical mode', async () => {
    createAccessory();
    (inst as any).cachedStatus = { swing_mode: 'Vertical' };
    const result = await new Promise((resolve) => {
      (inst as any).handleGet((err: any, val: any) => {
        resolve({ err, val });
      });
    });
    const castedResult = result as { err: any, val: any };
    expect(castedResult.err).toBeNull();
    expect(castedResult.val).toBe(false);
  });

  it('should handle get with no cached status', async () => {
    createAccessory();
    (inst as any).cachedStatus = null;
    const result = await new Promise((resolve) => {
      (inst as any).handleGet((err: any, val: any) => {
        resolve({ err, val });
      });
    });
    const castedResult = result as { err: any, val: any };
    expect(castedResult.err).toBeNull();
    expect(castedResult.val).toBe(false);
  });

  it('should handle set ON when vertical is OFF', async () => {
    createAccessory();
    (inst as any).cachedStatus = { swing_mode: 'Off' };
    const cb = vi.fn();
    updateStateMock.mockResolvedValueOnce({ swing_mode: 'Horizontal' });
    await (inst as any).handleSet(true, cb);
    expect(setSwingModeMock).toHaveBeenCalledWith('Horizontal');
    expect(cb).toHaveBeenCalledWith(null);
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', true);
  });

  it('should handle set ON when vertical is ON', async () => {
    createAccessory();
    (inst as any).cachedStatus = { swing_mode: 'Vertical' };
    const cb = vi.fn();
    updateStateMock.mockResolvedValueOnce({ swing_mode: 'Both' });
    await (inst as any).handleSet(true, cb);
    expect(setSwingModeMock).toHaveBeenCalledWith('Both');
    expect(cb).toHaveBeenCalledWith(null);
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', true);
  });

  it('should handle set OFF when both are ON', async () => {
    createAccessory();
    (inst as any).cachedStatus = { swing_mode: 'Both' };
    const cb = vi.fn();
    updateStateMock.mockResolvedValueOnce({ swing_mode: 'Vertical' });
    await (inst as any).handleSet(false, cb);
    expect(setSwingModeMock).toHaveBeenCalledWith('Vertical');
    expect(cb).toHaveBeenCalledWith(null);
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', false);
  });

  it('should handle set OFF when only horizontal is ON', async () => {
    createAccessory();
    (inst as any).cachedStatus = { swing_mode: 'Horizontal' };
    const cb = vi.fn();
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
    const cb = vi.fn();
    await (inst as any).handleSet(true, cb);
    expect(cb).toHaveBeenCalledWith(error);
  });
});