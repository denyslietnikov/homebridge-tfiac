import { PlatformAccessory } from 'homebridge';
import { DrySwitchAccessory } from '../DrySwitchAccessory.js';
import { TfiacPlatform } from '../platform.js';

jest.useFakeTimers();

// ---------- mocks ---------------------------------------------------
const updateStateMock = jest.fn();
const setStateMock   = jest.fn();
const cleanupMock    = jest.fn();

jest.mock('../AirConditionerAPI.js', () => {
  return jest.fn().mockImplementation(() => ({
    updateState:            updateStateMock,
    setAirConditionerState: setStateMock,
    cleanup:                cleanupMock,
  }));
});

const mockPlatform = (): TfiacPlatform =>
  ({
    Service: { Switch: jest.fn() },
    Characteristic: { Name: 'Name', On: 'On', ConfiguredName: 'ConfiguredName' },
    log: { debug: jest.fn(), error: jest.fn(), info: jest.fn() },
  } as unknown as TfiacPlatform);

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
    getService: jest.fn(),
    addService: jest.fn(),
    getServiceById: jest.fn(),
  } as unknown as PlatformAccessory);

// --------------------------------------------------------------------

describe('DrySwitchAccessory - unit', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let inst: DrySwitchAccessory;

  beforeEach(() => {
    jest.clearAllMocks();
    platform = mockPlatform();
    accessory = makeAccessory();
    (accessory.getService as jest.Mock).mockReturnValue(undefined);
    (accessory.addService as jest.Mock).mockReturnValue(mockService);
    updateStateMock.mockResolvedValue({ operation_mode: 'auto' });
  });

  afterEach(() => {
    if (inst) {
      inst.stopPolling();
    }
  });

  it('polls and updates characteristic', async () => {
    (accessory.getService as jest.Mock).mockReturnValue(undefined);
    inst = new DrySwitchAccessory(platform, accessory);
    updateStateMock.mockResolvedValueOnce({ operation_mode: 'dehumi' });
    jest.advanceTimersByTime(1500);
    await Promise.resolve();
    await jest.runOnlyPendingTimersAsync();

    expect(mockService.updateCharacteristic).toHaveBeenCalledWith('On', true);
  });

  it('handleGet returns correct value', (done) => {
    inst = new DrySwitchAccessory(platform, accessory);
    (inst as any).cachedStatus = { operation_mode: 'dehumi' };
    (inst as any).handleGet((err: Error | null, value?: boolean) => {
      expect(err).toBeNull();
      expect(value).toBe(true);
      done();
    });
  });

  it('handleSet turns mode on and off', async () => {
    inst = new DrySwitchAccessory(platform, accessory);
    const cb = jest.fn();

    await (inst as any).handleSet(true, cb);
    expect(setStateMock).toHaveBeenCalledWith('operation_mode', 'dehumi');
    expect(cb).toHaveBeenCalledWith(null);
    cb.mockClear();

    await (inst as any).handleSet(false, cb);
    expect(setStateMock).toHaveBeenCalledWith('operation_mode', 'auto');
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('should construct and set up polling and handlers', () => {
    (accessory.getService as jest.Mock).mockReturnValue(undefined);
    inst = new DrySwitchAccessory(platform, accessory);
    expect(accessory.addService).toHaveBeenCalledWith(platform.Service.Switch, 'Dry', 'dry');
    expect(mockService.setCharacteristic).toHaveBeenCalledWith('Name', 'Dry');
    expect(mockService.getCharacteristic).toHaveBeenCalledWith('On');
  });

  it('should use existing service if available', () => {
    (accessory.getService as jest.Mock).mockReturnValue(mockService);
    inst = new DrySwitchAccessory(platform, accessory);
    expect(accessory.addService).not.toHaveBeenCalled();
    expect(mockService.setCharacteristic).toHaveBeenCalledWith('Name', 'Dry');
  });

  it('should set configured name in constructor', () => {
    inst = new DrySwitchAccessory(platform, accessory);
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.ConfiguredName,
      'Dry',
    );
  });

  it('handleGet returns false when no cachedStatus', done => {
    inst = new DrySwitchAccessory(platform, accessory);
    (inst as any).cachedStatus = undefined;
    (inst as any).handleGet((err: Error | null, value?: boolean) => {
      expect(err).toBeNull();
      expect(value).toBe(false);
      done();
    });
  });

  it('updateCachedStatus skips when already polling', async () => {
    inst = new DrySwitchAccessory(platform, accessory);
    // simulate already polling
    (inst as any).isPolling = true;
    updateStateMock.mockClear();
    await (inst as any).updateCachedStatus();
    expect(updateStateMock).not.toHaveBeenCalled();
  });

  it('updateCachedStatus does not update when status unchanged', async () => {
    inst = new DrySwitchAccessory(platform, accessory);
    const initialStatus = { operation_mode: 'auto' };
    updateStateMock.mockResolvedValue(initialStatus);
    // set cachedStatus same as next
    (inst as any).cachedStatus = { ...initialStatus };
    mockService.updateCharacteristic.mockClear();
    await (inst as any).updateCachedStatus();
    // should not call updateCharacteristic because no change
    expect(mockService.updateCharacteristic).not.toHaveBeenCalled();
  });

  it('updateCachedStatus logs error on failure', async () => {
    inst = new DrySwitchAccessory(platform, accessory);
    const error = new Error('fail');
    updateStateMock.mockRejectedValue(error);
    const logErrorSpy = platform.log.error as jest.Mock;
    await (inst as any).updateCachedStatus();
    expect(logErrorSpy).toHaveBeenCalledWith(
      `Error updating Dry Mode status for ${accessory.context.deviceConfig.name}:`,
      error,
    );
  });
});