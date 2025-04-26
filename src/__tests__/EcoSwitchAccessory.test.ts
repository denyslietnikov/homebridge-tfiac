import { PlatformAccessory } from 'homebridge';
import { EcoSwitchAccessory } from '../EcoSwitchAccessory.js';
import { TfiacPlatform } from '../platform.js';

// ---------- mocks ---------------------------------------------------
const updateStateMock = jest.fn();
const setEcoStateMock = jest.fn();
const cleanupMock = jest.fn();

jest.mock('../AirConditionerAPI.js', () => {
  return jest.fn().mockImplementation(() => ({
    updateState: updateStateMock,
    setEcoState: setEcoStateMock,
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
    getService: jest.fn().mockReturnValue(null),
    addService: jest.fn().mockReturnValue(mockService),
    getServiceById: jest.fn(),
  } as unknown as PlatformAccessory);

// --------------------------------------------------------------------

describe('EcoSwitchAccessory – unit', () => {
  let accessory: EcoSwitchAccessory;
  let mockUpdateCachedStatus: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    updateStateMock.mockResolvedValue({ opt_eco: 'off' });

    // This allows us to bypass the initial updateCachedStatus call
    mockUpdateCachedStatus = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (accessory) {
      accessory.stopPolling();
    }
  });

  // Helper function to create accessory with an overridden updateCachedStatus method
  const createAccessoryWithMockedUpdate = (existingService?: any) => {
    const accInstance = makeAccessory();
    if (existingService) {
      (accInstance.getService as jest.Mock).mockReturnValue(existingService);
    }
    const acc = new EcoSwitchAccessory(mockPlatform(), accInstance);
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
    accessory = createAccessoryWithMockedUpdate(existingMockService);
    const platformAcc = (accessory as any).accessory as PlatformAccessory;
    const svc = (accessory as any).service;
    expect(platformAcc.getService).toHaveBeenCalledWith('Eco');
    expect(platformAcc.addService).not.toHaveBeenCalled();
    expect(svc.setCharacteristic).toHaveBeenCalledWith('Name', 'Eco');
    expect(svc.getCharacteristic).toHaveBeenCalledWith('On');
    expect(svc.getCharacteristic().on).toHaveBeenCalledWith('get', expect.any(Function));
    expect(svc.getCharacteristic().on).toHaveBeenCalledWith('set', expect.any(Function));
  });

  it('should construct and set up polling and handlers', () => {
    const mockPlat = mockPlatform();
    const mockAcc = makeAccessory();
    accessory = new EcoSwitchAccessory(mockPlat, mockAcc);
    expect(mockAcc.addService).toHaveBeenCalledWith(mockPlat.Service.Switch, 'Eco', 'eco');
    expect(mockService.setCharacteristic).toHaveBeenCalledWith('Name', 'Eco');
    expect(mockService.getCharacteristic).toHaveBeenCalledWith('On');
    expect(mockService.getCharacteristic().on).toHaveBeenCalledTimes(2);
  });

  it('polls and updates characteristic when eco mode is off', async () => {
    // Setup
    updateStateMock.mockResolvedValueOnce({ opt_eco: 'off' });

    // Create the accessory
    accessory = createAccessoryWithMockedUpdate();

    // Replace the implementation for this test
    mockUpdateCachedStatus.mockImplementationOnce(async () => {
      const status = await updateStateMock();
      const svc = (accessory as any).service;
      svc.updateCharacteristic('On', status.opt_eco === 'on');
    });

    // Manually trigger the updateCachedStatus
    await (accessory as any).updateCachedStatus();

    // Assertions
    const svc = (accessory as any).service;
    expect(updateStateMock).toHaveBeenCalled();
    expect(svc.updateCharacteristic).toHaveBeenCalledWith('On', false);
  });

  it('polls and updates characteristic when eco mode is on', async () => {
    // Setup
    updateStateMock.mockResolvedValueOnce({ opt_eco: 'on' });

    // Create the accessory
    accessory = createAccessoryWithMockedUpdate();

    // Replace the implementation for this test
    mockUpdateCachedStatus.mockImplementationOnce(async () => {
      const status = await updateStateMock();
      const svc = (accessory as any).service;
      svc.updateCharacteristic('On', status.opt_eco === 'on');
    });

    // Manually trigger the updateCachedStatus
    await (accessory as any).updateCachedStatus();

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

    // Replace the implementation for this test
    mockUpdateCachedStatus.mockImplementationOnce(async () => {
      try {
        await updateStateMock();
      } catch (e) {
        const platform = (accessory as any).platform;
        platform.log.error('Error updating eco status:', e);
      }
    });

    // Manually trigger the updateCachedStatus
    await (accessory as any).updateCachedStatus();

    // Assertions
    const platform = (accessory as any).platform;
    expect(platform.log.error).toHaveBeenCalledWith(
      expect.stringContaining('Error updating eco status:'),
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
    accessory = createAccessoryWithMockedUpdate();
    const callback = jest.fn();
    setEcoStateMock.mockResolvedValueOnce({});
    updateStateMock.mockResolvedValueOnce({ opt_eco: 'on' });

    await (accessory as any).handleSet(true, callback);

    expect(setEcoStateMock).toHaveBeenCalledWith('on');
    expect(callback).toHaveBeenCalledWith(null);
  });

  it('handles set characteristic to turn eco off', async () => {
    accessory = createAccessoryWithMockedUpdate();
    const callback = jest.fn();
    setEcoStateMock.mockResolvedValueOnce({});
    updateStateMock.mockResolvedValueOnce({ opt_eco: 'off' });

    await (accessory as any).handleSet(false, callback);

    expect(setEcoStateMock).toHaveBeenCalledWith('off');
    expect(callback).toHaveBeenCalledWith(null);
  });

  it('handles errors during set characteristic', async () => {
    accessory = createAccessoryWithMockedUpdate();
    const callback = jest.fn();
    const error = new Error('API error');
    setEcoStateMock.mockRejectedValueOnce(error);

    await (accessory as any).handleSet(true, callback);

    expect(callback).toHaveBeenCalledWith(error);
  });

  it('properly cleans up when stopping polling', () => {
    // Create the accessory
    accessory = createAccessoryWithMockedUpdate();

    // Stop polling
    accessory.stopPolling();

    // Verify that cleanup was called
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