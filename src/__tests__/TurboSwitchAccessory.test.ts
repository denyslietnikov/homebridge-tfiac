import { CharacteristicSetCallback, PlatformAccessory } from 'homebridge';
import { TurboSwitchAccessory } from '../TurboSwitchAccessory';
import AirConditionerAPI from '../AirConditionerAPI';
import { TfiacPlatform } from '../platform';

// Mock dependencies
jest.mock('../AirConditionerAPI');

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
} as unknown as PlatformAccessory;

// Mock service setup
const mockService = {
  getCharacteristic: jest.fn().mockReturnThis(),
  setCharacteristic: jest.fn().mockReturnThis(),
  on: jest.fn().mockReturnThis(),
  updateCharacteristic: jest.fn(),
};

describe('TurboSwitchAccessory', () => {
  let turboAccessory: TurboSwitchAccessory;
  let mockAPI: jest.Mocked<AirConditionerAPI>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    // Set up the mocks
    (mockAccessory.getService as jest.Mock).mockReturnValue(null);
    (mockAccessory.addService as jest.Mock).mockReturnValue(mockService);
    (AirConditionerAPI as jest.MockedClass<typeof AirConditionerAPI>).mockClear();
    mockAPI = new AirConditionerAPI('') as jest.Mocked<AirConditionerAPI>;
    (AirConditionerAPI as jest.MockedClass<typeof AirConditionerAPI>).mockImplementation(() => mockAPI);
  });

  afterEach(() => {
    if (turboAccessory) turboAccessory.stopPolling();
    jest.useRealTimers();
  });

  it('should initialize correctly', () => {
    turboAccessory = new TurboSwitchAccessory(mockPlatform, mockAccessory);
    expect(mockAccessory.addService).toHaveBeenCalledWith(mockPlatform.Service.Switch, 'Turbo', 'turbo');
    expect(mockService.setCharacteristic).toHaveBeenCalledWith(mockPlatform.Characteristic.Name, 'Turbo Mode');
    expect(mockService.getCharacteristic).toHaveBeenCalledWith(mockPlatform.Characteristic.On);
    expect(mockService.on).toHaveBeenCalledTimes(2); // get and set handlers
  });

  it('should use existing service if available', () => {
    jest.clearAllMocks();
    (mockAccessory.getService as jest.Mock).mockReturnValue(mockService);
    turboAccessory = new TurboSwitchAccessory(mockPlatform, mockAccessory);
    expect(mockAccessory.addService).not.toHaveBeenCalled();
    expect(mockService.setCharacteristic).toHaveBeenCalledWith(mockPlatform.Characteristic.Name, 'Turbo Mode');
  });

  it('should start polling on initialization', () => {
    jest.useFakeTimers();
    turboAccessory = new TurboSwitchAccessory(mockPlatform, mockAccessory);
    // updateState is now called twice upon initialization (original + warm-up call)
    expect(mockAPI.updateState).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(10000);
    // After time passes, updateState is called again
    expect(mockAPI.updateState).toHaveBeenCalledTimes(3);
    turboAccessory.stopPolling();
  });

  it('should stop polling when stopPolling is called', () => {
    jest.useFakeTimers();
    turboAccessory = new TurboSwitchAccessory(mockPlatform, mockAccessory);
    turboAccessory.stopPolling();
    expect(mockAPI.cleanup).toHaveBeenCalledTimes(1);
    expect(mockPlatform.log.debug).toHaveBeenCalledWith(
      expect.stringContaining('stopped'),
      'Test Device'
    );
    jest.advanceTimersByTime(10000);
    expect(mockAPI.updateState).toHaveBeenCalledTimes(2);
  });

  it('should update cached status and characteristics', async () => {
    turboAccessory = new TurboSwitchAccessory(mockPlatform, mockAccessory);
    const mockStatus = {
      opt_super: 'on',
      current_temp: 25,
      target_temp: 24,
      operation_mode: 'cool',
      fan_mode: 'auto',
      is_on: 'on',
      swing_mode: 'Off',
    };
    mockAPI.updateState.mockResolvedValue(mockStatus);
    mockAPI.updateState.mockClear();
    await (turboAccessory as any).updateCachedStatus();
    expect(mockAPI.updateState).toHaveBeenCalledTimes(1);
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
      mockPlatform.Characteristic.On,
      true
    );
  });

  it('should handle errors when updating status', async () => {
    turboAccessory = new TurboSwitchAccessory(mockPlatform, mockAccessory);
    const error = new Error('Test error');
    mockAPI.updateState.mockRejectedValue(error);
    await (turboAccessory as any).updateCachedStatus();
    expect(mockPlatform.log.error).toHaveBeenCalledWith(
      expect.stringContaining('Error updating turbo status:'),
      error
    );
  });

  it('should handle get characteristic callback', () => {
    turboAccessory = new TurboSwitchAccessory(mockPlatform, mockAccessory);
    (turboAccessory as any).cachedStatus = {
      opt_super: 'on',
    };
    const callback = jest.fn();
    (turboAccessory as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it('should handle get characteristic callback with no cached status', () => {
    turboAccessory = new TurboSwitchAccessory(mockPlatform, mockAccessory);
    (turboAccessory as any).cachedStatus = null;
    const callback = jest.fn();
    (turboAccessory as any).handleGet(callback);
    // Now we expect a default value (false) instead of an error
    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it('should handle set characteristic callback', async () => {
    turboAccessory = new TurboSwitchAccessory(mockPlatform, mockAccessory);
    mockAPI.setTurboState.mockResolvedValue();
    const callback = jest.fn();
    await (turboAccessory as any).handleSet(true, callback);
    expect(mockAPI.setTurboState).toHaveBeenCalledWith('on');
    expect(callback).toHaveBeenCalledWith(null);
  });

  it('should handle errors in set characteristic callback', async () => {
    turboAccessory = new TurboSwitchAccessory(mockPlatform, mockAccessory);
    const error = new Error('Test error');
    mockAPI.setTurboState.mockRejectedValue(error);
    const callback = jest.fn();
    await (turboAccessory as any).handleSet(true, callback);
    expect(callback).toHaveBeenCalledWith(error);
  });
});