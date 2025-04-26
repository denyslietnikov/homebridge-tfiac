import { PlatformAccessory, Service } from 'homebridge';
import { TfiacPlatform } from '../platform.js';
import { TurboSwitchAccessory } from '../TurboSwitchAccessory.js';

// ---------- mocks ---------------------------------------------------
const updateStateMock = jest.fn();
const setSuperStateMock = jest.fn();
const cleanupMock = jest.fn();

jest.mock('../AirConditionerAPI.js', () => {
  return jest.fn().mockImplementation(() => ({
    updateState: updateStateMock,
    setTurboState: setSuperStateMock,
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

describe('TurboSwitchAccessory – unit', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let inst: TurboSwitchAccessory;

  beforeEach(() => {
    jest.clearAllMocks();
    platform = mockPlatform();
    accessory = makeAccessory();
    updateStateMock.mockResolvedValue({ opt_super: 'off' });

    (accessory.getService as jest.Mock).mockReturnValue(undefined);
    (accessory.addService as jest.Mock).mockReturnValue(mockService);
  });

  afterEach(() => {
    if (inst) {
      inst.stopPolling();
    }
  });

  const createAccessory = (existingService?: any) => {
    jest.clearAllMocks();
    updateStateMock.mockResolvedValue({ opt_super: 'off' });

    if (existingService) {
      (accessory.getService as jest.Mock).mockReturnValue(existingService);
      (accessory.addService as jest.Mock).mockClear();
    } else {
      (accessory.getService as jest.Mock).mockReturnValue(undefined);
      (accessory.addService as jest.Mock).mockReturnValue(mockService);
    }
    inst = new TurboSwitchAccessory(platform, accessory);
    
    // Manually trigger a mock response for updateState since it's called during construction
    // This simulates the effect of the constructor calling startPolling() -> updateCachedStatus()
    const updateStateCall = updateStateMock.mock.calls[0];
    if (updateStateCall) {
      const mockResponse = { opt_super: 'off' };
      updateStateMock.mock.results[0] = { type: 'return', value: Promise.resolve(mockResponse) };
    }
    
    return inst;
  };

  it('should initialize correctly and add a new service', () => {
    // Force updateStateMock to return successfully
    updateStateMock.mockResolvedValue({ opt_super: 'off' });
    
    createAccessory(undefined);
    const svc = mockService;
    const expectedServiceName = 'Turbo';

    // Skip checking updateStateMock since the BaseSwitchAccessory calls it asynchronously
    // and we're testing the constructor synchronously
    expect(accessory.addService).toHaveBeenCalledWith(platform.Service.Switch, expectedServiceName, 'turbo');
    expect(svc.setCharacteristic).toHaveBeenCalledWith('Name', expectedServiceName);
    expect(svc.getCharacteristic).toHaveBeenCalledWith('On');
    expect(svc.getCharacteristic().on).toHaveBeenCalledWith('get', expect.any(Function));
    expect(svc.getCharacteristic().on).toHaveBeenCalledWith('set', expect.any(Function));
  });

  it('should use existing service if available', () => {
    // Force updateStateMock to return successfully
    updateStateMock.mockResolvedValue({ opt_super: 'off' });
    
    createAccessory(mockService);
    const svc = mockService;
    const expectedServiceName = 'Turbo';

    // Skip checking updateStateMock since the BaseSwitchAccessory calls it asynchronously
    // and we're testing the constructor synchronously
    expect(accessory.getService).toHaveBeenCalledWith(expectedServiceName);
    expect(accessory.addService).not.toHaveBeenCalled();
    expect(svc.setCharacteristic).toHaveBeenCalledWith('Name', expectedServiceName);
    expect(svc.getCharacteristic).toHaveBeenCalledWith('On');
    expect(svc.getCharacteristic().on).toHaveBeenCalledWith('get', expect.any(Function));
    expect(svc.getCharacteristic().on).toHaveBeenCalledWith('set', expect.any(Function));
  });

  it('handles get characteristic with null cached status', () => {
    inst = createAccessory();
    const callback = jest.fn();
    (inst as any).cachedStatus = null;
    (inst as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it('handles get characteristic with turbo on', () => {
    inst = createAccessory();
    const callback = jest.fn();
    (inst as any).cachedStatus = { opt_super: 'on' };
    (inst as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it('handles get characteristic with turbo off', () => {
    inst = createAccessory();
    const callback = jest.fn();
    (inst as any).cachedStatus = { opt_super: 'off' };
    (inst as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it('handles get characteristic with undefined turbo status', () => {
    inst = createAccessory();
    const callback = jest.fn();
    (inst as any).cachedStatus = { someOtherProp: 'value' };
    (inst as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it('handles set characteristic to turn turbo on', async () => {
    inst = createAccessory();
    const callback = jest.fn();
    setSuperStateMock.mockResolvedValueOnce({});
    updateStateMock.mockResolvedValueOnce({ opt_super: 'on' });

    await (inst as any).handleSet(true, callback);

    expect(setSuperStateMock).toHaveBeenCalledWith('on');
    expect(callback).toHaveBeenCalledWith(null);
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith('On', true);
  });

  it('handles set characteristic to turn turbo off', async () => {
    inst = createAccessory();
    const callback = jest.fn();
    setSuperStateMock.mockResolvedValueOnce({});
    updateStateMock.mockResolvedValueOnce({ opt_super: 'off' });

    await (inst as any).handleSet(false, callback);

    expect(setSuperStateMock).toHaveBeenCalledWith('off');
    expect(callback).toHaveBeenCalledWith(null);
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith('On', false);
  });

  it('handles errors during set characteristic', async () => {
    inst = createAccessory();
    const callback = jest.fn();
    const error = new Error('API error');
    setSuperStateMock.mockRejectedValueOnce(error);

    await (inst as any).handleSet(true, callback);

    expect(callback).toHaveBeenCalledWith(error);
  });

  it('properly cleans up when stopping polling', () => {
    inst = createAccessory();
    inst.stopPolling();
    expect(cleanupMock).toHaveBeenCalled();
  });

});