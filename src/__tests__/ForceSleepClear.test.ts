// Test for the forceSleepClear functionality - point 12 from specification.txt
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

describe('ForceSleepClear Implementation - Point 12', () => {
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

  it('should force include sleep=off when forceSleepClear flag is set, even when sleep is already off', async () => {
    // Setup: Device is currently off with sleep mode off
    const currentStatus = {
      is_on: PowerState.Off,
      operation_mode: OperationMode.Cool,
      target_temp: 22,
      current_temp: 22,
      fan_mode: FanSpeed.Medium,
      swing_mode: SwingMode.Off,
      opt_sleepMode: SleepModeState.Off,  // Sleep is already OFF
      opt_turbo: PowerState.Off,
      opt_eco: PowerState.Off,
      opt_display: PowerState.On,
      opt_beep: PowerState.On,
    };

    // Mock API responses
    mockAPI.updateState.mockResolvedValue(currentStatus);
    mockAPI.setOptionsCombined.mockResolvedValue(currentStatus);

    // Initialize the cache manager's internal state by calling updateDeviceState
    // This is essential for applyStateToDevice to have a current state to compare against
    await cacheManager.updateDeviceState();

    // Create desired state with forceSleepClear flag - importantly, this must be different from current state
    const desiredState = cacheManager.getDeviceState().clone();
    desiredState.setPower(PowerState.On); // This is different from current PowerState.Off
    desiredState.setTurboMode(PowerState.Off);
    desiredState.setSleepMode(SleepModeState.Off); // This is the same as current state
    
    // Add the forceSleepClear flag (simulating TurboSwitchAccessory turning off Turbo)
    (desiredState as DeviceState & { forceSleepClear?: boolean }).forceSleepClear = true;

    // Act: Apply the state change
    await cacheManager.applyStateToDevice(desiredState);

    // Assert: setOptionsCombined should have been called with sleep: 'off' included
    expect(mockCommandQueue.enqueueCommand).toHaveBeenCalledTimes(1);
    const calledOptions = mockCommandQueue.enqueueCommand.mock.calls[0][0];
    
    // Verify that sleep: 'off' was included in the API call even though it didn't change (due to forceSleepClear)
    expect(calledOptions).toHaveProperty('sleep', SleepModeState.Off);
    expect(calledOptions).toHaveProperty('power', PowerState.On);
    // fanSpeed is included when power changes (this is expected behavior)
    expect(calledOptions).toHaveProperty('fanSpeed', FanSpeed.Medium);
    // turbo is not included because it didn't change and forceSleepClear only affects sleep

    // Verify the forceSleepClear flag was cleaned up
    expect((desiredState as DeviceState & { forceSleepClear?: boolean }).forceSleepClear).toBeUndefined();
  }, 10000); // Increase timeout to 10 seconds

  it('should work normally without forceSleepClear flag - sleep should not be included when unchanged', async () => {
    // Setup: Device is currently off with sleep mode off
    const currentStatus = {
      is_on: PowerState.Off,
      operation_mode: OperationMode.Cool,
      target_temp: 22,
      current_temp: 22,
      fan_mode: FanSpeed.Medium,
      swing_mode: SwingMode.Off,
      opt_sleepMode: SleepModeState.Off,  // Sleep is already OFF
      opt_turbo: PowerState.Off,
      opt_eco: PowerState.Off,
      opt_display: PowerState.On,
      opt_beep: PowerState.On,
    };

    // Mock API responses
    mockAPI.updateState.mockResolvedValue(currentStatus);
    mockAPI.setOptionsCombined.mockResolvedValue(currentStatus);

    // Initialize the cache manager's internal state
    await cacheManager.updateDeviceState();

    // Create desired state WITHOUT forceSleepClear flag - importantly, this must be different from current state
    const desiredState = cacheManager.getDeviceState().clone();
    desiredState.setPower(PowerState.On); // This is different from current PowerState.Off
    desiredState.setTurboMode(PowerState.Off);
    desiredState.setSleepMode(SleepModeState.Off); // This is the same as current state

    // NO forceSleepClear flag set

    // Act: Apply the state change
    await cacheManager.applyStateToDevice(desiredState);

    // Assert: enqueueCommand should have been called without sleep parameter
    expect(mockCommandQueue.enqueueCommand).toHaveBeenCalledTimes(1);
    const calledOptions = mockCommandQueue.enqueueCommand.mock.calls[0][0];
    
    // Verify that sleep was NOT included in the API call since it didn't change
    expect(calledOptions).not.toHaveProperty('sleep');
    expect(calledOptions).toHaveProperty('power', PowerState.On);
    // fanSpeed is included when power changes (this is expected behavior)
    expect(calledOptions).toHaveProperty('fanSpeed', FanSpeed.Medium);
    // turbo is not included because it didn't change
  }, 10000); // Increase timeout to 10 seconds

  it('should handle forceSleepClear even when other sleep changes are present', async () => {
    // Setup: Device is currently on with sleep mode on
    const currentStatus = {
      is_on: PowerState.On,
      operation_mode: OperationMode.Cool,
      target_temp: 22,
      current_temp: 22,
      fan_mode: FanSpeed.Medium,
      swing_mode: SwingMode.Off,
      opt_sleepMode: SleepModeState.On,  // Sleep is currently ON
      opt_turbo: PowerState.Off,
      opt_eco: PowerState.Off,
      opt_display: PowerState.On,
      opt_beep: PowerState.On,
    };

    // Mock API responses
    mockAPI.updateState.mockResolvedValue(currentStatus);
    mockAPI.setOptionsCombined.mockResolvedValue({
      ...currentStatus,
      opt_sleepMode: SleepModeState.Off,
    });

    // Initialize the cache manager's internal state
    await cacheManager.updateDeviceState();

    // Create desired state that would normally change sleep from On to Off
    const desiredState = cacheManager.getDeviceState().clone();
    desiredState.setPower(PowerState.On);
    desiredState.setTurboMode(PowerState.Off);
    desiredState.setSleepMode(SleepModeState.Off); // This is different from current state
    
    // Add the forceSleepClear flag (shouldn't interfere with normal sleep changes)
    (desiredState as DeviceState & { forceSleepClear?: boolean }).forceSleepClear = true;

    // Act: Apply the state change
    await cacheManager.applyStateToDevice(desiredState);

    // Assert: enqueueCommand should have been called with sleep: 'off'
    expect(mockCommandQueue.enqueueCommand).toHaveBeenCalledTimes(1);
    const calledOptions = mockCommandQueue.enqueueCommand.mock.calls[0][0];
    
    // Sleep should be included (because it changed from On to Off)
    expect(calledOptions).toHaveProperty('sleep', SleepModeState.Off);
    // Power and turbo are not included because they didn't change from the current state

    // Verify the forceSleepClear flag was cleaned up
    expect((desiredState as DeviceState & { forceSleepClear?: boolean }).forceSleepClear).toBeUndefined();
  }, 10000); // Increase timeout to 10 seconds
});
