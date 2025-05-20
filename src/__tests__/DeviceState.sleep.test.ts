import { vi, it, expect, describe, beforeEach } from 'vitest';
import { DeviceState } from '../state/DeviceState.js';
import { SleepModeState, PowerState } from '../enums.js';

describe('DeviceState - Sleep Mode Transition', () => {
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

  it('should ignore intermediate off state during sleep mode transition', () => {
    // First, set the _sleepMode directly to ensure we have the right value from the enum
    deviceState['_sleepMode'] = SleepModeState.On;
    // Set the timestamp for when sleep was last set to On
    deviceState['_lastSleepCmdTime'] = Date.now();

    // Verify sleep mode is ON
    expect(deviceState.sleepMode).toBe(SleepModeState.On);

    // Simulate first status update with "off:0:0:0:0:0:0:0:0:0:0" during transition
    const firstUpdate = deviceState.updateFromDevice({
      opt_sleepMode: 'off:0:0:0:0:0:0:0:0:0:0',
    });

    // Sleep mode should still be ON despite the "off" response
    expect(deviceState.sleepMode).toBe(SleepModeState.On);
    // Verify debug message was logged
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining('Ignoring intermediate off state for sleep mode during transition')
    );
    
    // Advance time by mocking Date.now() to simulate passage of 5 seconds
    const originalDateNow = Date.now;
    const mockTime = originalDateNow() + 5000; // 5 seconds later
    global.Date.now = vi.fn(() => mockTime);
    
    try {
      // Now simulate a second update with "off:0:0:0:0:0:0:0:0:0:0" after delay
      const secondUpdate = deviceState.updateFromDevice({
        opt_sleepMode: 'off:0:0:0:0:0:0:0:0:0:0',
      });
      
      // After 5 seconds, the "off" state should be accepted
      expect(deviceState.sleepMode).toBe(SleepModeState.Off);
    } finally {
      // Restore original Date.now
      global.Date.now = originalDateNow;
    }
  });

  it('should accept sleepMode1 updates immediately during transition', () => {
    // First, set the _sleepMode directly to ensure we have the right value from the enum
    deviceState['_sleepMode'] = SleepModeState.On;
    // Set the timestamp for when sleep was last set to On
    deviceState['_lastSleepCmdTime'] = Date.now();

    // Verify sleep mode is ON
    expect(deviceState.sleepMode).toBe(SleepModeState.On);

    // Simulate status update with "sleepMode1:0:0:0:0:0:0:0:0:0:0" (confirmation from device)
    const update = deviceState.updateFromDevice({
      opt_sleepMode: 'sleepMode1:0:0:0:0:0:0:0:0:0:0',
    });

    // Sleep mode should still be ON
    expect(deviceState.sleepMode).toBe(SleepModeState.On);
  });
});
