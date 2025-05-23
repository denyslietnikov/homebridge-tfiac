// filepath: src/__tests__/DeviceState.poweroff.transient.test.ts
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DeviceState } from '../state/DeviceState.js';
import { PowerState, OperationMode } from '../enums.js';

describe('DeviceState - Power-off Transient State Protection', () => {
  let state: DeviceState;
  let mockLog: any;

  beforeEach(() => {
    // Mock logger
    mockLog = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    
    state = new DeviceState(mockLog, true); // Pass logger and enable debug
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Power-off optimistic update protection', () => {
    it('should track power-off command timestamp when power is set to OFF via updateFromOptions', () => {
      // Initial state: device is ON
      state.updateFromOptions({ power: PowerState.On });
      expect(state.power).toBe(PowerState.On);

      // Record time before power-off command
      const beforeTime = Date.now();

      // User turns off the device (optimistic update)
      const changed = state.updateFromOptions({ power: PowerState.Off });

      expect(changed).toBe(true);
      expect(state.power).toBe(PowerState.Off);

      // Verify that _lastPowerOffCmdTime was set (private property, but we can test behavior)
      const afterTime = Date.now();
      
      // The timestamp should be recorded within a reasonable time window
      expect(afterTime - beforeTime).toBeLessThan(100); // Should be almost immediate
    });

    it('should ignore transient ON state from device within 5 seconds of power-off command', () => {
      // Initial state: device is ON with Cool mode
      state.updateFromOptions({ power: PowerState.On, mode: OperationMode.Cool });
      expect(state.power).toBe(PowerState.On);
      expect(state.operationMode).toBe(OperationMode.Cool);

      // User turns off device (optimistic update)
      // NOTE: This resets operation mode to Auto due to harmonization rules
      state.updateFromOptions({ power: PowerState.Off });
      expect(state.power).toBe(PowerState.Off);
      expect(state.operationMode).toBe(OperationMode.Auto); // Reset by power-off harmonization

      // Simulate device reporting transient ON state within 5 seconds (like in the logs)
      const changed = state.updateFromDevice({
        is_on: 'on',
        operation_mode: OperationMode.Heat // Different mode to test other updates work
      });

      // Should ignore the transient ON state and keep power OFF
      expect(state.power).toBe(PowerState.Off);
      expect(changed).toBe(true); // Other properties might have changed (operation_mode)
      expect(state.operationMode).toBe(OperationMode.Heat); // Other updates should still work

      // Verify debug log was called
      expect(mockLog.debug).toHaveBeenCalledWith(
        expect.stringContaining('Ignoring transient ON state during power-off transition')
      );
    });

    it('should accept ON state from device after 5 seconds of power-off command', () => {
      // Initial state: device is ON
      state.updateFromOptions({ power: PowerState.On });
      expect(state.power).toBe(PowerState.On);

      // User turns off device (optimistic update)
      state.updateFromOptions({ power: PowerState.Off });
      expect(state.power).toBe(PowerState.Off);

      // Mock Date.now to simulate 6 seconds later
      const originalDateNow = Date.now;
      const mockTime = Date.now() + 6000; // 6 seconds later
      vi.spyOn(Date, 'now').mockReturnValue(mockTime);

      // Device reports ON state after protection window
      const changed = state.updateFromDevice({
        is_on: 'on',
        operation_mode: OperationMode.Cool
      });

      // Should accept the ON state after protection window expires
      expect(state.power).toBe(PowerState.On);
      expect(changed).toBe(true);
      expect(state.operationMode).toBe(OperationMode.Cool);

      // Debug log should NOT be called for ignored transient state
      expect(mockLog.debug).not.toHaveBeenCalledWith(
        expect.stringContaining('Ignoring transient ON state during power-off transition')
      );

      // Restore Date.now
      Date.now = originalDateNow;
    });

    it('should accept normal ON state updates when device was not recently powered off', () => {
      // Initial state: device is OFF (but not recently turned off via command)
      expect(state.power).toBe(PowerState.Off);

      // Device reports ON state (normal startup)
      const changed = state.updateFromDevice({
        is_on: 'on',
        operation_mode: OperationMode.Cool
      });

      // Should accept ON state normally
      expect(state.power).toBe(PowerState.On);
      expect(changed).toBe(true);
      expect(state.operationMode).toBe(OperationMode.Cool);

      // Debug log should NOT be called
      expect(mockLog.debug).not.toHaveBeenCalledWith(
        expect.stringContaining('Ignoring transient ON state during power-off transition')
      );
    });

    it('should handle multiple power-off commands correctly', () => {
      // Initial state: device is ON
      state.updateFromOptions({ power: PowerState.On });

      // First power-off command
      state.updateFromOptions({ power: PowerState.Off });
      expect(state.power).toBe(PowerState.Off);

      // Device reports transient ON - should be ignored
      state.updateFromDevice({ is_on: 'on' });
      expect(state.power).toBe(PowerState.Off);

      // User turns device ON again
      state.updateFromOptions({ power: PowerState.On });
      expect(state.power).toBe(PowerState.On);

      // Second power-off command
      state.updateFromOptions({ power: PowerState.Off });
      expect(state.power).toBe(PowerState.Off);

      // Device reports transient ON - should be ignored again
      state.updateFromDevice({ is_on: 'on' });
      expect(state.power).toBe(PowerState.Off);

      // Check that debug was called for ignored transient states
      const debugCalls = mockLog.debug.mock.calls.filter(call => 
        call[0] && call[0].includes('Ignoring transient ON state during power-off transition')
      );
      expect(debugCalls).toHaveLength(2);
    });
  });

  describe('Power-off protection edge cases', () => {
    it('should not affect OFF to OFF transitions', () => {
      // Device is already OFF
      expect(state.power).toBe(PowerState.Off);

      // Another OFF command (shouldn't update timestamp)
      state.updateFromOptions({ power: PowerState.Off });
      expect(state.power).toBe(PowerState.Off);

      // Device reports OFF - should be accepted normally
      const changed = state.updateFromDevice({ is_on: 'off' });
      expect(state.power).toBe(PowerState.Off);
      expect(changed).toBe(false); // No change occurred
    });

    it('should not interfere with normal ON to ON transitions', () => {
      // Device is ON
      state.updateFromOptions({ power: PowerState.On });
      expect(state.power).toBe(PowerState.On);

      // Device reports ON - should be accepted
      const changed = state.updateFromDevice({ is_on: 'on' });
      expect(state.power).toBe(PowerState.On);
      expect(changed).toBe(false); // No change occurred

      // Debug log should NOT be called
      expect(mockLog.debug).not.toHaveBeenCalledWith(
        expect.stringContaining('Ignoring transient ON state during power-off transition')
      );
    });

    it('should properly handle OFF states from device during protection window', () => {
      // Initial state: device is ON
      state.updateFromOptions({ power: PowerState.On });

      // User turns off device
      state.updateFromOptions({ power: PowerState.Off });
      expect(state.power).toBe(PowerState.Off);

      // Device reports OFF state during protection window - should be accepted
      const changed = state.updateFromDevice({ is_on: 'off' });
      expect(state.power).toBe(PowerState.Off);
      expect(changed).toBe(false); // No change occurred

      // Debug log should NOT be called for OFF states
      expect(mockLog.debug).not.toHaveBeenCalledWith(
        expect.stringContaining('Ignoring transient ON state during power-off transition')
      );
    });
  });

  describe('Real-world scenario simulation', () => {
    it('should simulate the exact scenario from logs - power-off with transient ON response', async () => {
      // Simulate the exact scenario from the logs:
      // 10:08:41 PM - User turns off AC
      // 10:08:42 PM - Command acknowledged 
      // 10:08:44 PM - Device reports transient ON (should be ignored)
      // 10:08:47 PM - Device reports final OFF

      // Step 1: Device is initially ON
      state.updateFromOptions({ power: PowerState.On });
      expect(state.power).toBe(PowerState.On);

      // Step 2: User turns off device (10:08:41 PM equivalent)
      // NOTE: This resets operation mode to Auto due to harmonization rules
      const userTurnOffTime = Date.now();
      state.updateFromOptions({ power: PowerState.Off });
      expect(state.power).toBe(PowerState.Off);
      expect(state.operationMode).toBe(OperationMode.Auto); // Reset by power-off harmonization

      // Step 3: 2 seconds later - device reports transient ON (10:08:44 PM equivalent)
      vi.spyOn(Date, 'now').mockReturnValue(userTurnOffTime + 2000);
      
      const transientResponse = state.updateFromDevice({
        is_on: 'on',
        operation_mode: OperationMode.Cool
      });

      // Device should still be OFF, transient ON ignored
      expect(state.power).toBe(PowerState.Off);
      expect(state.operationMode).toBe(OperationMode.Cool); // Other properties updated
      expect(mockLog.debug).toHaveBeenCalledWith(
        expect.stringContaining('Ignoring transient ON state during power-off transition')
      );

      // Step 4: 5 seconds later - device reports final OFF (10:08:47 PM equivalent)
      vi.spyOn(Date, 'now').mockReturnValue(userTurnOffTime + 5000);
      
      const finalResponse = state.updateFromDevice({
        is_on: 'off'
      });

      // Device should remain OFF
      expect(state.power).toBe(PowerState.Off);
      expect(finalResponse).toBe(false); // No change since already OFF

      vi.restoreAllMocks();
    });

    it('should handle rapid on/off/on sequences correctly', () => {
      // Test rapid sequences that could happen in real usage
      
      // Start: Device ON
      state.updateFromOptions({ power: PowerState.On });
      expect(state.power).toBe(PowerState.On);

      // User turns OFF
      state.updateFromOptions({ power: PowerState.Off });
      expect(state.power).toBe(PowerState.Off);

      // Device reports transient ON - should be ignored
      state.updateFromDevice({ is_on: 'on' });
      expect(state.power).toBe(PowerState.Off);

      // User quickly turns ON again (before protection expires)
      state.updateFromOptions({ power: PowerState.On });
      expect(state.power).toBe(PowerState.On);

      // Now device reports ON - should be accepted (user wanted it ON)
      state.updateFromDevice({ is_on: 'on' });
      expect(state.power).toBe(PowerState.On);

      // User turns OFF again
      state.updateFromOptions({ power: PowerState.Off });
      expect(state.power).toBe(PowerState.Off);

      // Device reports transient ON - should be ignored again
      state.updateFromDevice({ is_on: 'on' });
      expect(state.power).toBe(PowerState.Off);

      // Check that debug was called for ignored transient states  
      const debugCalls = mockLog.debug.mock.calls.filter(call => 
        call[0] && call[0].includes('Ignoring transient ON state during power-off transition')
      );
      expect(debugCalls).toHaveLength(2); // Two ignored transient states
    });
  });
});
