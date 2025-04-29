// Mock dependencies
const updateStateMock = jest.fn();
const setDisplayStateMock = jest.fn();
const cleanupMock = jest.fn(); // Shared cleanup mock

jest.mock('../AirConditionerAPI.js', () => {
  return jest.fn().mockImplementation(() => ({
    updateState: updateStateMock,
    setDisplayState: setDisplayStateMock,
    cleanup: cleanupMock, // Use shared mock
  }));
});

import { DisplaySwitchAccessory } from '../DisplaySwitchAccessory.js';
import { TfiacPlatform } from '../platform.js';
import { PlatformAccessory, Service } from 'homebridge';

describe('DisplaySwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let service: Service;
  let inst: DisplaySwitchAccessory; // Keep track of the instance

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

  beforeEach(() => {
    jest.clearAllMocks(); // Clear all mocks before each test
    platform = mockPlatform();
    service = mockService;
    accessory = makeAccessory();
    updateStateMock.mockResolvedValue({ opt_display: 'on' }); // Default mock response
    setDisplayStateMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (inst) {
      inst.stopPolling(); // Ensure polling stops after each test
    }
    jest.restoreAllMocks();
  });

  const createAccessory = () => {
    inst = new DisplaySwitchAccessory(platform, accessory);
    return inst;
  };

  it('should construct and set up polling and handlers', () => {
    createAccessory();
    expect(accessory.addService).toHaveBeenCalledWith(platform.Service.Switch, 'Display', 'display');
    expect(service.setCharacteristic).toHaveBeenCalledWith('Name', 'Display');
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

  it('should update cached status and update characteristic', async () => {
    createAccessory();
    updateStateMock.mockResolvedValueOnce({ opt_display: 'on' });
    await (inst as any).updateCachedStatus();
    expect(updateStateMock).toHaveBeenCalled();
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', true);
  });

  it('should handle get with cached status', done => {
    createAccessory();
    (inst as any).cachedStatus = { opt_display: 'on' };
    (inst as any).handleGet((err: any, val: any) => {
      expect(err).toBeNull();
      expect(val).toBe(true);
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

  it('should handle set and update status', async () => {
    createAccessory();
    const cb = jest.fn();
    setDisplayStateMock.mockResolvedValueOnce(undefined);
    await (inst as any).handleSet(true, cb);
    expect(setDisplayStateMock).toHaveBeenCalledWith('on');
    expect(cb).toHaveBeenCalledWith(null);
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', true);
  });

  it('should handle set error', async () => {
    createAccessory();
    const error = new Error('fail');
    setDisplayStateMock.mockRejectedValueOnce(error);
    const cb = jest.fn();
    await (inst as any).handleSet(true, cb);
    expect(setDisplayStateMock).toHaveBeenCalledWith('on');
    expect(cb).toHaveBeenCalledWith(error);
  });
});