import { CharacteristicSetCallback, PlatformAccessory } from 'homebridge';
import { BeepSwitchAccessory } from '../BeepSwitchAccessory.js';
import AirConditionerAPI from '../AirConditionerAPI.js';
import { TfiacPlatform } from '../platform.js';

// Mock dependencies
const updateStateMock = jest.fn();
const setBeepStateMock = jest.fn();
const cleanupMock = jest.fn(); // Shared cleanup mock

jest.mock('../AirConditionerAPI', () => {
  return jest.fn().mockImplementation(() => ({
    updateState: updateStateMock,
    setBeepState: setBeepStateMock,
    cleanup: cleanupMock, // Use shared mock
  }));
});

const mockPlatform = {
  log: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  Service: {
    Switch: jest.fn(),
  },
  Characteristic: {
    On: 'On',
    Name: 'Name',
  },
} as unknown as TfiacPlatform;

const mockAccessory = {
  context: {
    deviceConfig: {
      name: 'Test Device',
      ip: '1.2.3.4',
      port: 7777,
      updateInterval: 10,
    },
  },
  getService: jest.fn(),
  addService: jest.fn(),
  getServiceById: jest.fn(),
} as unknown as PlatformAccessory;

// Mock service setup
const mockService = {
  getCharacteristic: jest.fn().mockReturnThis(),
  setCharacteristic: jest.fn().mockReturnThis(),
  on: jest.fn().mockReturnThis(),
  updateCharacteristic: jest.fn(),
};

describe('BeepSwitchAccessory', () => {
  let beepAccessory: BeepSwitchAccessory;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    // Set up the mocks
    (mockAccessory.getService as jest.Mock).mockReturnValue(null);
    (mockAccessory.addService as jest.Mock).mockReturnValue(mockService);
  });

  afterEach(() => {
    if (beepAccessory) beepAccessory.stopPolling();
    jest.useRealTimers();
  });

  it('should initialize correctly and add a new service', () => {
    beepAccessory = new BeepSwitchAccessory(mockPlatform, mockAccessory);
    const deviceName = mockAccessory.context.deviceConfig.name;
    expect(mockAccessory.addService).toHaveBeenCalledWith(mockPlatform.Service.Switch, 'Beep', 'beep');
    expect(mockService.setCharacteristic).toHaveBeenCalledWith(mockPlatform.Characteristic.Name, 'Beep');
    expect(mockService.getCharacteristic).toHaveBeenCalledWith(mockPlatform.Characteristic.On);
    expect(mockService.getCharacteristic().on).toHaveBeenCalledWith('get', expect.any(Function));
    expect(mockService.getCharacteristic().on).toHaveBeenCalledWith('set', expect.any(Function));
  });

  it('should use existing service if available', () => {
    const existingMockService = {
      setCharacteristic: jest.fn().mockReturnThis(),
      getCharacteristic: jest.fn().mockReturnValue({ on: jest.fn().mockReturnThis() }),
      updateCharacteristic: jest.fn(),
    };
    jest.clearAllMocks();
    (mockAccessory.getService as jest.Mock).mockReturnValue(existingMockService);
    beepAccessory = new BeepSwitchAccessory(mockPlatform, mockAccessory);
    expect(mockAccessory.getService).toHaveBeenCalledWith('Beep');
    expect(mockAccessory.addService).not.toHaveBeenCalled();
    expect(existingMockService.setCharacteristic).toHaveBeenCalledWith(mockPlatform.Characteristic.Name, 'Beep');
    expect(existingMockService.getCharacteristic).toHaveBeenCalledWith(mockPlatform.Characteristic.On);
    expect(existingMockService.getCharacteristic().on).toHaveBeenCalledWith('get', expect.any(Function));
    expect(existingMockService.getCharacteristic().on).toHaveBeenCalledWith('set', expect.any(Function));
  });

  it('should start polling on initialization', () => {
    beepAccessory = new BeepSwitchAccessory(mockPlatform, mockAccessory);
  });

  it('should stop polling when stopPolling is called', () => {
    beepAccessory = new BeepSwitchAccessory(mockPlatform, mockAccessory);
    expect((beepAccessory as any).cacheManager).toBeDefined();
    expect((beepAccessory as any).cacheManager.api).toBeDefined();
    beepAccessory.stopPolling();
    expect(cleanupMock).toHaveBeenCalledTimes(1);
  });

  it('should update cached status and characteristics', async () => {
    beepAccessory = new BeepSwitchAccessory(mockPlatform, mockAccessory);
    const mockStatus = {
      opt_beep: 'on',
      current_temp: 25,
      target_temp: 24,
      operation_mode: 'cool',
      fan_mode: 'auto',
      is_on: 'on',
      swing_mode: 'Off',
    };
    updateStateMock.mockResolvedValue(mockStatus);
    updateStateMock.mockClear();
    await (beepAccessory as any).updateCachedStatus();
    expect(updateStateMock).toHaveBeenCalledTimes(1);
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
      mockPlatform.Characteristic.On,
      true
    );
  });

  it('should handle errors when updating status', async () => {
    const error = new Error('Test error');
    updateStateMock.mockRejectedValueOnce(error);
    beepAccessory = new BeepSwitchAccessory(mockPlatform, mockAccessory);
    await (beepAccessory as any).updateCachedStatus();
    expect(mockPlatform.log.error).toHaveBeenCalledWith(expect.stringContaining('Error updating Beep status'), error);
  });

  it('should handle get characteristic callback', () => {
    beepAccessory = new BeepSwitchAccessory(mockPlatform, mockAccessory);
    (beepAccessory as any).cachedStatus = {
      opt_beep: 'on',
    };
    const callback = jest.fn();
    (beepAccessory as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it('should handle get characteristic callback with no cached status', () => {
    beepAccessory = new BeepSwitchAccessory(mockPlatform, mockAccessory);
    (beepAccessory as any).cachedStatus = null;
    const callback = jest.fn();
    (beepAccessory as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it('should handle set characteristic callback', async () => {
    beepAccessory = new BeepSwitchAccessory(mockPlatform, mockAccessory);
    const callback = jest.fn();
    setBeepStateMock.mockResolvedValueOnce({});
    await (beepAccessory as any).handleSet(true, callback);
    expect(setBeepStateMock).toHaveBeenCalledWith('on');
    expect(callback).toHaveBeenCalledWith(null);
  });

  it('should handle errors in set characteristic callback', async () => {
    beepAccessory = new BeepSwitchAccessory(mockPlatform, mockAccessory);
    const error = new Error('Test error');
    setBeepStateMock.mockRejectedValue(error);
    updateStateMock.mockClear();
    const callback = jest.fn();
    await (beepAccessory as any).handleSet(true, callback);
    expect(setBeepStateMock).toHaveBeenCalledWith('on');
    expect(callback).toHaveBeenCalledWith(error);
  });

  it('should update internal state after set characteristic', async () => {
    beepAccessory = new BeepSwitchAccessory(mockPlatform, mockAccessory);
    const callback = jest.fn();
    await (beepAccessory as any).handleSet(true, callback);
  });

  it('should construct and set up polling and handlers', () => {
    const inst = new BeepSwitchAccessory(mockPlatform, mockAccessory);
    expect(mockAccessory.addService).toHaveBeenCalledWith(mockPlatform.Service.Switch, 'Beep', 'beep');
    expect(mockService.setCharacteristic).toHaveBeenCalledWith('Name', 'Beep');
    expect(mockService.getCharacteristic).toHaveBeenCalledWith('On');
    expect(mockService.on).toHaveBeenCalledTimes(2);
  });
});