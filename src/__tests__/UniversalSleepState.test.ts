// filepath: /Users/denisletnikov/Code/homebridge-tfiac/src/__tests__/UniversalSleepState.test.ts
// Test for the universal sleep state preservation - point 13 from specification.txt
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CacheManager } from '../CacheManager.js';
import { DeviceState } from '../state/DeviceState.js';
import { PowerState, SleepModeState, OperationMode, FanSpeed, SwingMode } from '../enums.js';
import { TfiacDeviceConfig } from '../settings.js';
import AirConditionerAPI from '../AirConditionerAPI.js';

// Mock the AirConditionerAPI
vi.mock('../AirConditionerAPI.js', () => {
  const mockAPI = {
    updateState: vi.fn(),
    setOptionsCombined: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    removeListener: vi.fn(),
    removeAllListeners: vi.fn(),
    cleanup: vi.fn(),
  };
  return {
    default: vi.fn(() => mockAPI),
  };
});

describe('Universal Sleep State Preservation - Point 13', () => {
  let cacheManager: CacheManager;
  let mockAPI: any;
  let mockConfig: TfiacDeviceConfig;
  let mockLogger: any;
  let mockCommandQueue: any;

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock config
    mockConfig = {
      ip: '192.168.1.100',
      port: 7777,
      name: 'Test AC',
      model: 'Test Model',
      updateInterval: 30,
      commandRetryDelay: 1000,
      maxRetries: 3,
      enabledFeatures: {},
    };

    // Create mock logger
    mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    // Get the mocked API constructor
    const MockedAirConditionerAPI = vi.mocked(AirConditionerAPI);
    MockedAirConditionerAPI.mockImplementation(() => {
      mockAPI = {
        updateState: vi.fn(),
        setOptionsCombined: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
        removeListener: vi.fn(),
        removeAllListeners: vi.fn(),
        cleanup: vi.fn(),
      };
      return mockAPI;
    });

    // Create cache manager instance
    cacheManager = CacheManager.getInstance(mockConfig, mockLogger);

    // Create a mock for CommandQueue with enqueueCommand method
    mockCommandQueue = {
      enqueueCommand: vi.fn().mockResolvedValue(undefined),
      removeAllListeners: vi.fn(),
      on: vi.fn(),
    };
    
    // Mock the getCommandQueue method to return our mockCommandQueue
    cacheManager.getCommandQueue = vi.fn().mockReturnValue(mockCommandQueue);
  });

  it('should always include current sleep state in commands - universal sleep state preservation', async () => {
    // Setup: Device is currently off with sleep mode off
    const currentStatus = {
      is_on: PowerState.Off,
      operation_mode: OperationMode.Cool,
      target_temp: 22,
      current_temp: 22,
      fan_mode: FanSpeed.Medium,
      swing_mode: SwingMode.Off,
      opt_sleepMode: SleepModeState.Off,  // Sleep is OFF
      opt_turbo: PowerState.Off,
      opt_eco: PowerState.Off,
      opt_display: PowerState.On,
      opt_beep: PowerState.On,
    };

    // Mock API responses
    mockAPI.updateState.mockResolvedValue(currentStatus);
    mockAPI.setOptionsCombined.mockResolvedValue({
      ...currentStatus,
      is_on: PowerState.On,
    });

    // Initialize the cache manager's internal state by calling updateDeviceState
    await cacheManager.updateDeviceState();

    // Create desired state - change power from Off to On, keep sleep the same
    const desiredState = cacheManager.getDeviceState().clone();
    desiredState.setPower(PowerState.On); // This is different from current PowerState.Off
    desiredState.setSleepMode(SleepModeState.Off); // This is the same as current state

    // Act: Apply the state change
    await cacheManager.applyStateToDevice(desiredState);

    // Assert: setOptionsCombined should always include current sleep state
    expect(mockCommandQueue.enqueueCommand).toHaveBeenCalledTimes(1);
    const calledOptions = mockCommandQueue.enqueueCommand.mock.calls[0][0];
    
    // Verify that sleep is ALWAYS included in the API call (universal sleep state preservation)
    expect(calledOptions).toHaveProperty('sleep', SleepModeState.Off);
    expect(calledOptions).toHaveProperty('power', PowerState.On);
  }, 10000); // Increase timeout to 10 seconds

  it('should always include sleep state even when only other properties change', async () => {
    // Setup: Device is currently on with sleep mode off (to make test simpler)
    const currentStatus = {
      is_on: PowerState.On,
      operation_mode: OperationMode.Cool,
      target_temp: 22,
      current_temp: 22,
      fan_mode: FanSpeed.Medium,
      swing_mode: SwingMode.Off,
      opt_sleepMode: SleepModeState.Off,  // Sleep is currently OFF
      opt_turbo: PowerState.Off,
      opt_eco: PowerState.Off,
      opt_display: PowerState.On,
      opt_beep: PowerState.On,
    };

    // Mock API responses
    mockAPI.updateState.mockResolvedValue(currentStatus);
    mockAPI.setOptionsCombined.mockResolvedValue({
      ...currentStatus,
      target_temp: 24,
    });

    // Initialize the cache manager's internal state
    await cacheManager.updateDeviceState();

    // Create desired state that only changes temperature, keeps everything else the same
    const desiredState = cacheManager.getDeviceState().clone();
    desiredState.setTargetTemperature(24); // Change only temperature
    // Sleep mode stays the same (Off)

    // Act: Apply the state change
    await cacheManager.applyStateToDevice(desiredState);

    // Assert: enqueueCommand should always include current sleep state
    expect(mockCommandQueue.enqueueCommand).toHaveBeenCalledTimes(1);
    const calledOptions = mockCommandQueue.enqueueCommand.mock.calls[0][0];
    
    // Sleep should always be included (universal sleep state preservation)
    expect(calledOptions).toHaveProperty('sleep', SleepModeState.Off);
    expect(calledOptions).toHaveProperty('temp', 24);
  }, 10000); // Increase timeout to 10 seconds

  it('should include current sleep state when sleep mode actually changes', async () => {
    // Setup: First establish the device as powered on to avoid power-on transition logic
    const initialStatus = {
      is_on: PowerState.On,
      operation_mode: OperationMode.Cool,
      target_temp: 22,
      current_temp: 22,
      fan_mode: FanSpeed.Medium,
      swing_mode: SwingMode.Off,
      opt_sleepMode: SleepModeState.Off,  // Sleep starts OFF
      opt_turbo: PowerState.Off,
      opt_eco: PowerState.Off,
      opt_display: PowerState.On,
      opt_beep: PowerState.On,
    };

    // Mock the initial status call
    mockAPI.updateState.mockResolvedValueOnce(initialStatus);
    
    // Initialize with device powered on and sleep off
    await cacheManager.updateDeviceState();
    
    // Verify initial state
    let currentState = cacheManager.getDeviceState();
    expect(currentState.power).toBe(PowerState.On);
    expect(currentState.sleepMode).toBe(SleepModeState.Off);

    // Now setup: Device has sleep mode turned on
    const statusWithSleepOn = {
      is_on: PowerState.On,
      operation_mode: OperationMode.Cool,
      target_temp: 22,
      current_temp: 22,
      fan_mode: FanSpeed.Medium,
      swing_mode: SwingMode.Off,
      opt_sleepMode: SleepModeState.On,  // Sleep is now ON
      opt_turbo: PowerState.Off,
      opt_eco: PowerState.Off,
      opt_display: PowerState.On,
      opt_beep: PowerState.On,
    };

    // Mock API responses for subsequent calls
    mockAPI.updateState.mockResolvedValue(statusWithSleepOn);
    mockAPI.setOptionsCombined.mockResolvedValue({
      ...statusWithSleepOn,
      opt_sleepMode: SleepModeState.Off,
    });

    // Update state again to get sleep mode ON
    await cacheManager.updateDeviceState();

    // Verify the current state has sleep mode On
    currentState = cacheManager.getDeviceState();
    expect(currentState.sleepMode).toBe(SleepModeState.On);

    // Create desired state that changes sleep from On to Off
    const desiredState = currentState.clone();
    desiredState.setSleepMode(SleepModeState.Off); // This is different from current state
    
    // Verify desired state is different
    expect(desiredState.sleepMode).toBe(SleepModeState.Off);
    expect(desiredState.sleepMode).not.toBe(currentState.sleepMode);

    // Act: Apply the state change
    await cacheManager.applyStateToDevice(desiredState);

    // Assert: enqueueCommand should include the new sleep state
    expect(mockCommandQueue.enqueueCommand).toHaveBeenCalledTimes(1);
    const calledOptions = mockCommandQueue.enqueueCommand.mock.calls[0][0];
    
    // Sleep should be included with the new value
    expect(calledOptions).toHaveProperty('sleep', SleepModeState.Off);
  }, 10000); // Increase timeout to 10 seconds
});
