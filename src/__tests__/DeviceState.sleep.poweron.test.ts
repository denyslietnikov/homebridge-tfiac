import { vi, it, expect, describe, beforeEach } from 'vitest';
import { DeviceState } from '../state/DeviceState.js';
import { SleepModeState, PowerState, OperationMode } from '../enums.js';

describe('DeviceState - Sleep Mode during Power On', () => {
  let deviceState: DeviceState;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    deviceState = new DeviceState(mockLogger, true); // Enable debug
  });

  it('should not activate sleep mode when powering on the device if sleep was previously off', () => {
    // Set initial state - power off, sleep off
    deviceState['_power'] = PowerState.Off;
    deviceState['_sleepMode'] = SleepModeState.Off;
    
    // Verify initial state
    expect(deviceState.power).toBe(PowerState.Off);
    expect(deviceState.sleepMode).toBe(SleepModeState.Off);
    
    // Simulate first status update with power on and 'sleepMode1' in the response
    const update = deviceState.updateFromDevice({
      is_on: PowerState.On,
      operation_mode: OperationMode.Cool,
      opt_sleepMode: 'sleepMode1:0:0:0:0:0:0:0:0:0:0'
    });
    
    // After the update, power should be on and sleep should STILL be OFF
    expect(deviceState.power).toBe(PowerState.On);
    expect(deviceState.sleepMode).toBe(SleepModeState.Off);
    
    // Should log that it ignored the spurious sleep mode
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining('Ignoring spurious sleep mode during power-on')
    );
  });

  it('should maintain sleep mode when powering on the device if sleep was previously on', () => {
    // Set initial state - power off, sleep on
    deviceState['_power'] = PowerState.Off;
    deviceState['_sleepMode'] = SleepModeState.On;
    
    // Verify initial state (note: this might not reflect real behavior since power off usually resets sleep)
    expect(deviceState.power).toBe(PowerState.Off);
    expect(deviceState.sleepMode).toBe(SleepModeState.On);
    
    // Simulate first status update with power on and 'sleepMode1' in the response
    const update = deviceState.updateFromDevice({
      is_on: PowerState.On,
      operation_mode: OperationMode.Cool,
      opt_sleepMode: 'sleepMode1:0:0:0:0:0:0:0:0:0:0'
    });
    
    // After the update, power should be on and sleep should STILL be on
    expect(deviceState.power).toBe(PowerState.On);
    expect(deviceState.sleepMode).toBe(SleepModeState.On);
    
    // Should log that it accepted the sleep mode
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining('Accepting sleep mode ON state')
    );
  });
});
