import { CharacteristicSetCallback, PlatformAccessory } from 'homebridge';
import { BeepSwitchAccessory } from '../BeepSwitchAccessory';
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

describe('BeepSwitchAccessory', () => {
  let beepAccessory: BeepSwitchAccessory;
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
    if (beepAccessory) beepAccessory.stopPolling();
    jest.useRealTimers();
  });

  it('should initialize correctly', () => {
    beepAccessory = new BeepSwitchAccessory(mockPlatform, mockAccessory);
    expect(mockAccessory.addService).toHaveBeenCalledWith(mockPlatform.Service.Switch, 'Beep', 'beep');
    expect(mockService.setCharacteristic).toHaveBeenCalledWith(mockPlatform.Characteristic.Name, 'Beep');
    expect(mockService.getCharacteristic).toHaveBeenCalledWith(mockPlatform.Characteristic.On);
    expect(mockService.on).toHaveBeenCalledTimes(2); // get and set handlers
  });

  it('should use existing service if available', () => {
    jest.clearAllMocks();
    (mockAccessory.getService as jest.Mock).mockReturnValue(mockService);
    beepAccessory = new BeepSwitchAccessory(mockPlatform, mockAccessory);
    expect(mockAccessory.addService).not.toHaveBeenCalled();
    expect(mockService.setCharacteristic).toHaveBeenCalledWith(mockPlatform.Characteristic.Name, 'Beep');
  });

  it('should start polling on initialization', () => {
    jest.useFakeTimers();
    beepAccessory = new BeepSwitchAccessory(mockPlatform, mockAccessory);
    // Initial call to updateState happens immediately
    expect(mockAPI.updateState).toHaveBeenCalledTimes(1);
    
    // When we advance timers past the random delay
    jest.advanceTimersByTime(15000);
    // In Jest's timer simulation environment, setTimeout callbacks are all fired when time is advanced,
    // so we see more calls than expected in real usage
    expect(mockAPI.updateState).toHaveBeenCalledTimes(3);
    
    // Fast-forward time for regular interval
    jest.advanceTimersByTime(10000);
    // After time passes, updateState is called again
    expect(mockAPI.updateState).toHaveBeenCalledTimes(4);
    
    beepAccessory.stopPolling();
  });

  it('should stop polling when stopPolling is called', () => {
    jest.useFakeTimers();
    beepAccessory = new BeepSwitchAccessory(mockPlatform, mockAccessory);
    beepAccessory.stopPolling();
    expect(mockAPI.cleanup).toHaveBeenCalledTimes(1);
    expect(mockPlatform.log.debug).toHaveBeenCalledWith(
      expect.stringContaining('stopped'),
      'Test Device'
    );
    // Fast-forward time
    jest.advanceTimersByTime(10000);
    // Should not call updateState again after stopping
    expect(mockAPI.updateState).toHaveBeenCalledTimes(2);
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
    mockAPI.updateState.mockResolvedValue(mockStatus);
    mockAPI.updateState.mockClear();
    // Call the private method using any
    await (beepAccessory as any).updateCachedStatus();
    expect(mockAPI.updateState).toHaveBeenCalledTimes(1);
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
      mockPlatform.Characteristic.On,
      true
    );
  });

  it('should handle errors when updating status', async () => {
    beepAccessory = new BeepSwitchAccessory(mockPlatform, mockAccessory);
    const error = new Error('Test error');
    mockAPI.updateState.mockRejectedValue(error);
    // Call the private method using any
    await (beepAccessory as any).updateCachedStatus();
    expect(mockPlatform.log.error).toHaveBeenCalledWith(
      expect.stringContaining('Error updating beep status:'),
      error
    );
  });

  it('should handle get characteristic callback', () => {
    beepAccessory = new BeepSwitchAccessory(mockPlatform, mockAccessory);
    // Set up the mock cached status
    (beepAccessory as any).cachedStatus = {
      opt_beep: 'on',
    };
    const callback = jest.fn();
    // Call the private method using any
    (beepAccessory as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it('should handle get characteristic callback with no cached status', () => {
    beepAccessory = new BeepSwitchAccessory(mockPlatform, mockAccessory);
    // Set up empty cached status
    (beepAccessory as any).cachedStatus = null;
    const callback = jest.fn();
    // Call the private method using any
    (beepAccessory as any).handleGet(callback);
    // Now we expect a default value (false) instead of an error
    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it('should handle set characteristic callback', async () => {
    beepAccessory = new BeepSwitchAccessory(mockPlatform, mockAccessory);
    mockAPI.setBeepState.mockResolvedValue();
    mockAPI.updateState.mockResolvedValue({
      current_temp: 25,
      target_temp: 24,
      operation_mode: 'cool',
      fan_mode: 'auto',
      is_on: 'on',
      swing_mode: 'Off',
      opt_beep: 'on'
    });
    const callback = jest.fn();
    // Call the private method using any
    await (beepAccessory as any).handleSet(true, callback);
    expect(mockAPI.setBeepState).toHaveBeenCalledWith('on');
    // updateCachedStatus is called after setBeepState, which leads to updateState being called
    expect(mockAPI.updateState).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(null);
  });

  it('should handle errors in set characteristic callback', async () => {
    beepAccessory = new BeepSwitchAccessory(mockPlatform, mockAccessory);
    const error = new Error('Test error');
    mockAPI.setBeepState.mockRejectedValue(error);
    mockAPI.updateState.mockClear();
    const callback = jest.fn();
    // Call the private method using any
    await (beepAccessory as any).handleSet(true, callback);
    expect(mockAPI.setBeepState).toHaveBeenCalledWith('on');
    // When there's an error in setBeepState, updateState should not be called
    expect(mockAPI.updateState).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(error);
  });

  it('should update internal state after set characteristic', async () => {
    beepAccessory = new BeepSwitchAccessory(mockPlatform, mockAccessory);
    mockAPI.setBeepState.mockResolvedValue();
    mockAPI.updateState.mockResolvedValue({
      current_temp: 25,
      target_temp: 24,
      operation_mode: 'cool',
      fan_mode: 'auto',
      is_on: 'on',
      swing_mode: 'Off',
      opt_beep: 'on'
    });
    mockAPI.updateState.mockClear();
    const callback = jest.fn();
    await (beepAccessory as any).handleSet(true, callback);
    expect(mockAPI.updateState).toHaveBeenCalledTimes(1);
  });
});