import { CharacteristicSetCallback, PlatformAccessory } from 'homebridge';
import { EcoSwitchAccessory } from '../EcoSwitchAccessory';
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

describe('EcoSwitchAccessory', () => {
  let ecoAccessory: EcoSwitchAccessory;
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
    if (ecoAccessory) ecoAccessory.stopPolling();
    jest.useRealTimers();
  });

  it('should initialize correctly', () => {
    ecoAccessory = new EcoSwitchAccessory(mockPlatform, mockAccessory);
    expect(mockAccessory.addService).toHaveBeenCalledWith(mockPlatform.Service.Switch, 'Eco', 'eco');
    expect(mockService.setCharacteristic).toHaveBeenCalledWith(mockPlatform.Characteristic.Name, 'ECO Mode');
    expect(mockService.getCharacteristic).toHaveBeenCalledWith(mockPlatform.Characteristic.On);
    expect(mockService.on).toHaveBeenCalledTimes(2); // get and set handlers
  });

  it('should use existing service if available', () => {
    jest.clearAllMocks();
    (mockAccessory.getService as jest.Mock).mockReturnValue(mockService);
    ecoAccessory = new EcoSwitchAccessory(mockPlatform, mockAccessory);
    expect(mockAccessory.addService).not.toHaveBeenCalled();
    expect(mockService.setCharacteristic).toHaveBeenCalledWith(mockPlatform.Characteristic.Name, 'ECO Mode');
  });

  it('should start polling on initialization', () => {
    jest.useFakeTimers();
    ecoAccessory = new EcoSwitchAccessory(mockPlatform, mockAccessory);
    expect(mockAPI.updateState).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(10000);
    expect(mockAPI.updateState).toHaveBeenCalledTimes(2);
    ecoAccessory.stopPolling();
  });

  it('should stop polling when stopPolling is called', () => {
    jest.useFakeTimers();
    ecoAccessory = new EcoSwitchAccessory(mockPlatform, mockAccessory);
    ecoAccessory.stopPolling();
    expect(mockAPI.cleanup).toHaveBeenCalledTimes(1);
    expect(mockPlatform.log.debug).toHaveBeenCalledWith(
      expect.stringContaining('stopped'),
      'Test Device'
    );
    jest.advanceTimersByTime(10000);
    expect(mockAPI.updateState).toHaveBeenCalledTimes(1);
  });

  it('should update cached status and characteristics', async () => {
    ecoAccessory = new EcoSwitchAccessory(mockPlatform, mockAccessory);
    const mockStatus = {
      opt_eco: 'on',
      current_temp: 25,
      target_temp: 24,
      operation_mode: 'cool',
      fan_mode: 'auto',
      is_on: 'on',
      swing_mode: 'Off',
    };
    mockAPI.updateState.mockResolvedValue(mockStatus);
    mockAPI.updateState.mockClear();
    await (ecoAccessory as any).updateCachedStatus();
    expect(mockAPI.updateState).toHaveBeenCalledTimes(1);
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
      mockPlatform.Characteristic.On,
      true
    );
  });

  it('should handle errors when updating status', async () => {
    ecoAccessory = new EcoSwitchAccessory(mockPlatform, mockAccessory);
    const error = new Error('Test error');
    mockAPI.updateState.mockRejectedValue(error);
    await (ecoAccessory as any).updateCachedStatus();
    expect(mockPlatform.log.error).toHaveBeenCalledWith(
      expect.stringContaining('Error updating eco status:'),
      error
    );
  });

  it('should handle get characteristic callback', () => {
    ecoAccessory = new EcoSwitchAccessory(mockPlatform, mockAccessory);
    (ecoAccessory as any).cachedStatus = {
      opt_eco: 'on',
    };
    const callback = jest.fn();
    (ecoAccessory as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it('should handle get characteristic callback with error when no status', () => {
    ecoAccessory = new EcoSwitchAccessory(mockPlatform, mockAccessory);
    (ecoAccessory as any).cachedStatus = null;
    const callback = jest.fn();
    (ecoAccessory as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(expect.any(Error));
  });

  it('should handle set characteristic callback', async () => {
    ecoAccessory = new EcoSwitchAccessory(mockPlatform, mockAccessory);
    mockAPI.setEcoState.mockResolvedValue();
    const callback = jest.fn();
    await (ecoAccessory as any).handleSet(true, callback);
    expect(mockAPI.setEcoState).toHaveBeenCalledWith('on');
    expect(callback).toHaveBeenCalledWith(null);
  });

  it('should handle errors in set characteristic callback', async () => {
    ecoAccessory = new EcoSwitchAccessory(mockPlatform, mockAccessory);
    const error = new Error('Test error');
    mockAPI.setEcoState.mockRejectedValue(error);
    const callback = jest.fn();
    await (ecoAccessory as any).handleSet(true, callback);
    expect(callback).toHaveBeenCalledWith(error);
  });
});