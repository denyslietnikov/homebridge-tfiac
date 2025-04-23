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
    getService: jest.fn().mockReturnValue(null),
    addService: jest.fn().mockReturnValue(mockService),
    getServiceById: jest.fn(),
  } as unknown as PlatformAccessory);

// --------------------------------------------------------------------

describe('DrySwitchAccessory – unit', () => {
  let accessory: DrySwitchAccessory;

  beforeEach(() => {
    jest.clearAllMocks();
    updateStateMock.mockResolvedValue({ operation_mode: 'auto' });
    accessory = new DrySwitchAccessory(mockPlatform(), makeAccessory());
  });

  afterEach(() => {
    accessory.stopPolling();
  });

  it('polls and updates characteristic', async () => {
    updateStateMock.mockResolvedValueOnce({ operation_mode: 'dehumi' });
    jest.advanceTimersByTime(1500);
    await Promise.resolve();

    const svc = (accessory as any).service;
    expect(svc.updateCharacteristic).toHaveBeenCalledWith('On', true);
  });

  it('handleGet returns correct value', done => {
    (accessory as any).cachedStatus = { operation_mode: 'dehumi' };
    (accessory as any).handleGet((err: Error | null, value?: boolean) => {
      expect(err).toBeNull();
      expect(value).toBe(true);
      done();
    });
  });

  it('handleSet turns mode on and off', async () => {
    const cb = jest.fn();

    await (accessory as any).handleSet(true, cb);
    expect(setStateMock).toHaveBeenCalledWith('operation_mode', 'dehumi');

    await (accessory as any).handleSet(false, cb);
    expect(setStateMock).toHaveBeenCalledWith('operation_mode', 'auto');
  });
});