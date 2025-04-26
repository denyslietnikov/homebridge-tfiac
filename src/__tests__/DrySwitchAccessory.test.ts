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
    Characteristic: { Name: 'Name', On: 'On' },
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

  it('handleGet returns correct value', (done) => { // Remove async
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
});