/**
 * Combined tests for all bug fixes:
 * 1. Sleep mode should not be spuriously activated after turbo-off
 * 2. Device-reported Auto fan speed should be preserved during device updates
 * 3. Fix fan speed harmonization especially Medium -> Auto issue
 * 4. Fix constant Medium → Auto fan speed log messages
 */

import { vi, describe, beforeEach, it, expect } from 'vitest';
import { DeviceState } from '../state/DeviceState.js';
import { AirConditionerStatus } from '../AirConditionerAPI.js';
import { FanSpeed, OperationMode, PowerState, SleepModeState } from '../enums.js';

// Mock platform for logging
const mockPlatform = {
  log: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
};

describe('DeviceState Bug Fixes', () => {
  let deviceState: DeviceState;
  
  beforeEach(() => {
    vi.clearAllMocks();
    deviceState = new DeviceState(mockPlatform.log as any, true); // Enable debug for tests
  });

  describe('Bug Fix 1: Sleep mode spurious activation after turbo-off', () => {
    it('should prevent sleep mode activation within 5 seconds of turbo-off command', () => {
      // Ensure device is powered on first (required for turbo mode)
      deviceState.setPower(PowerState.On);
      
      // Initial state: Turbo ON
      deviceState.setTurboMode(PowerState.On);
      expect(deviceState.turboMode).toBe(PowerState.On);
      
      // Turn turbo OFF (this should record the timestamp)
      deviceState.setTurboMode(PowerState.Off);
      expect(deviceState.turboMode).toBe(PowerState.Off);
      
      // Simulate device reporting sleep mode within 5 seconds (spurious activation)
      const deviceStatus: AirConditionerStatus = {
        is_on: PowerState.On,
        operation_mode: OperationMode.Cool,
        target_temp: 22,
        current_temp: 24,
        fan_mode: FanSpeed.Auto,
        swing_mode: 'Off',
        opt_turbo: PowerState.Off,
        opt_sleepMode: SleepModeState.On, // This should be ignored due to recent turbo-off
        opt_eco: PowerState.Off,
        opt_display: PowerState.On,
        outdoor_temp: 30,
      };
      
      deviceState.updateFromDevice(deviceStatus);
      
      // Sleep mode should NOT be activated (transient state protection)
      expect(deviceState.sleepMode).toBe(SleepModeState.Off);
      expect(mockPlatform.log.debug).toHaveBeenCalledWith(
        expect.stringContaining('Ignoring spurious sleep mode during turbo-off transition')
      );
    });

    it('should allow sleep mode activation after 5+ seconds from turbo-off', () => {
      // Use fake timers for this test
      vi.useFakeTimers();
      
      // Ensure device is powered on first (required for turbo mode)
      deviceState.setPower(PowerState.On);
      
      // Initial state: Turbo ON
      deviceState.setTurboMode(PowerState.On);
      expect(deviceState.turboMode).toBe(PowerState.On);
      
      // Turn turbo OFF
      deviceState.setTurboMode(PowerState.Off);
      expect(deviceState.turboMode).toBe(PowerState.Off);
      
      // Fast-forward 6 seconds
      vi.advanceTimersByTime(6000);
      
      // Simulate device reporting sleep mode
      const deviceStatus: AirConditionerStatus = {
        is_on: PowerState.On,
        operation_mode: OperationMode.Cool,
        target_temp: 22,
        current_temp: 24,
        fan_mode: FanSpeed.Auto,
        swing_mode: 'Off',
        opt_turbo: PowerState.Off,
        opt_sleepMode: SleepModeState.On, // This should be accepted after enough time has passed
        opt_eco: PowerState.Off,
        opt_display: PowerState.On,
        outdoor_temp: 30,
      };
      
      deviceState.updateFromDevice(deviceStatus);
      
      // Sleep mode should be activated (no longer in transient period)
      expect(deviceState.sleepMode).toBe(SleepModeState.On);
      
      // Restore real timers
      vi.useRealTimers();
    });
    
    it('should allow sleep mode activation after turbo-off protection ends (string value)', () => {
      // Reset the deviceState for a clean test
      deviceState = new DeviceState(mockPlatform.log as any, true);
      
      // Use fake timers for this test
      vi.useFakeTimers();
      
      // Ensure device is powered on first (required for turbo mode)
      deviceState.setPower(PowerState.On);
      
      // Initial state: Turbo ON
      deviceState.setTurboMode(PowerState.On);
      expect(deviceState.turboMode).toBe(PowerState.On);
      
      // Turn turbo OFF
      deviceState.setTurboMode(PowerState.Off);
      expect(deviceState.turboMode).toBe(PowerState.Off);
      
      // Fast-forward time past the protection period (5+ seconds)
      vi.advanceTimersByTime(6000);
      
      // Simulate device reporting sleep mode as string value
      const deviceStatus: AirConditionerStatus = {
        is_on: PowerState.On,
        operation_mode: OperationMode.Cool,
        target_temp: 22,
        current_temp: 24,
        fan_mode: FanSpeed.Auto,
        swing_mode: 'Off',
        opt_turbo: PowerState.Off,
        opt_sleepMode: 'sleepMode1:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0', // String value
        opt_eco: PowerState.Off,
        opt_display: PowerState.On,
        outdoor_temp: 30,
      };
      
      deviceState.updateFromDevice(deviceStatus);
      
      // Sleep mode should be activated (no longer in transient period)
      expect(deviceState.sleepMode).toBe(SleepModeState.On);
      
      // Restore real timers
      vi.useRealTimers();
    });

    it('should not affect normal sleep mode activation when turbo was not recently turned off', () => {
      // Reset mock and create fresh instance
      vi.clearAllMocks();
      deviceState = new DeviceState(mockPlatform.log as any, true);
      
      // Ensure device is powered on first
      deviceState.setPower(PowerState.On);
      
      // No recent turbo-off command
      // Skip device update and directly set sleep mode
      deviceState.setSleepMode(SleepModeState.On);
      
      // Sleep mode should be activated normally
      expect(deviceState.sleepMode).toBe(SleepModeState.On);
      
      // Also verify device update works
      const deviceStatus: AirConditionerStatus = {
        is_on: PowerState.On,
        operation_mode: OperationMode.Cool,
        target_temp: 22,
        current_temp: 24,
        fan_mode: FanSpeed.Auto,
        swing_mode: 'Off',
        opt_turbo: PowerState.Off,
        opt_sleepMode: SleepModeState.On, // Using enum value directly
        opt_eco: PowerState.Off,
        opt_display: PowerState.On,
        outdoor_temp: 30,
      };
      
      deviceState.updateFromDevice(deviceStatus);
      expect(deviceState.sleepMode).toBe(SleepModeState.On);
    });
  });

  describe('Bug Fix 2: Device-reported Auto fan speed preservation', () => {
    it('should preserve device-reported Auto fan speed during device updates', () => {
      // Simulate device reporting Auto fan speed
      const deviceStatus: AirConditionerStatus = {
        is_on: PowerState.On,
        operation_mode: OperationMode.Cool,
        target_temp: 22,
        current_temp: 24,
        fan_mode: FanSpeed.Auto, // Device reports Auto
        swing_mode: 'Off',
        opt_turbo: PowerState.Off,
        opt_sleepMode: SleepModeState.Off,
        opt_eco: PowerState.Off,
        opt_display: PowerState.On,
        outdoor_temp: 30,
      };
      
      deviceState.updateFromDevice(deviceStatus);
      
      // Fan speed should remain Auto (not harmonized to Medium)
      expect(deviceState.fanSpeed).toBe(FanSpeed.Auto);
    });

    it('should still harmonize fan speed for user commands (not device updates)', () => {
      // Ensure device is powered on first
      deviceState.setPower(PowerState.On);
      
      // Set initial state where harmonization rule R2 would apply
      deviceState.setTurboMode(PowerState.Off);
      deviceState.setSleepMode(SleepModeState.Off);
      
      // User command to set Auto fan speed (should be harmonized to Medium)
      deviceState.setFanSpeed(FanSpeed.Auto);
      
      // Fan speed should be harmonized to Auto per updated rule
      expect(deviceState.fanSpeed).toBe(FanSpeed.Auto);
    });

    it('should not harmonize Auto fan speed when device provides it during updates', () => {
      // Reset mock before this test
      vi.clearAllMocks();
      
      // Create fresh instance to ensure clean state
      deviceState = new DeviceState(mockPlatform.log as any, true);
      
      // Ensure device is powered on first
      deviceState.setPower(PowerState.On);
      
      // Start with Medium fan speed
      deviceState.setFanSpeed(FanSpeed.Medium);
      expect(deviceState.fanSpeed).toBe(FanSpeed.Medium);
      
      // Clear mocks after setup to ensure we only track logs during the update
      vi.clearAllMocks();
      
      // Device reports Auto fan speed
      const deviceStatus: AirConditionerStatus = {
        is_on: PowerState.On,
        operation_mode: OperationMode.Cool,
        target_temp: 22,
        current_temp: 24,
        fan_mode: FanSpeed.Auto, // Device reports Auto
        swing_mode: 'Off',
        opt_turbo: PowerState.Off,
        opt_sleepMode: SleepModeState.Off,
        opt_eco: PowerState.Off,
        opt_display: PowerState.On,
        outdoor_temp: 30,
      };
      
      deviceState.updateFromDevice(deviceStatus);
      
      // Fan speed should be Auto (preserved from device, not harmonized)
      expect(deviceState.fanSpeed).toBe(FanSpeed.Auto);
      
      // Should not see harmonization rule being applied during device update
      expect(mockPlatform.log.debug).not.toHaveBeenCalledWith(
        expect.stringContaining('Rule R2: Turbo and Sleep are OFF, converting Auto fan speed to Medium')
      );
    });
  });

  describe('Bug Fix 3: Handling Medium fan speed rejection', () => {
    it('should handle Medium fan speed being rejected', () => {
      // Use fake timers for this test
      vi.useFakeTimers();
      
      // Create fresh instance for this test to ensure clean state
      deviceState = new DeviceState(mockPlatform.log as any, true);
      
      // Ensure device is powered on first in Cool mode
      deviceState.setPower(PowerState.On);
      deviceState.setOperationMode(OperationMode.Cool);
      vi.clearAllMocks();
      
      // Set fan speed to Medium, which should set the _lastFanSpeedCmdTime timestamp
      deviceState.setFanSpeed(FanSpeed.Medium);
      expect(deviceState.fanSpeed).toBe(FanSpeed.Medium);
      
      // Prepare a device update where device reports Auto fan speed (rejected Medium)
      const deviceStatus: AirConditionerStatus = {
        is_on: PowerState.On,
        operation_mode: OperationMode.Cool,
        target_temp: 22, // Added missing property
        current_temp: 24, // Added missing property
        fan_mode: FanSpeed.Auto, // Device reports Auto instead of Medium
        swing_mode: 'Off', // Added missing property
        // Add other optional properties if needed for the test, or ensure they are handled as undefined
        opt_turbo: PowerState.Off,
        opt_sleepMode: SleepModeState.Off,
        opt_eco: PowerState.Off,
        opt_display: PowerState.On,
        outdoor_temp: 30,
      };
      
      // Simulate a device update within the 5-second window after setting Medium
      vi.advanceTimersByTime(3000);
      deviceState.updateFromDevice(deviceStatus);
      
      // Fan speed should now be Auto
      expect(deviceState.fanSpeed).toBe(FanSpeed.Auto);
      
      // Verify the _lastFanSpeedCmdTime was reset by making a second update and ensuring
      // we don't see any Medium rejection messages again
      vi.clearAllMocks();
      deviceState.updateFromDevice(deviceStatus);
      
      // After the second update, we shouldn't see any "Medium was rejected" message again
      // because the _lastFanSpeedCmdTime was reset to 0 after the first rejection
      const anyRejectionMessage = mockPlatform.log.debug.mock.calls.some(
        call => typeof call[0] === 'string' && call[0].includes('Medium was rejected')
      );
      expect(anyRejectionMessage).toBe(false);
      
      // Reset timers
      vi.useRealTimers();
    });
    
    it('should not output rejection message after timeout period', () => {
      // Use fake timers for this test
      vi.useFakeTimers();
      
      // Ensure device is powered on first
      deviceState.setPower(PowerState.On);
      
      // Set fan speed to Medium
      deviceState.setFanSpeed(FanSpeed.Medium);
      expect(deviceState.fanSpeed).toBe(FanSpeed.Medium);
      
      // Move past the 5-second window
      vi.advanceTimersByTime(6000);
      
      // Clear logs before update
      vi.clearAllMocks();
      
      // Mock a device update where device reports Auto instead of Medium (but outside window)
      const deviceStatus: AirConditionerStatus = {
        is_on: PowerState.On,
        operation_mode: OperationMode.Cool,
        target_temp: 22,
        current_temp: 24,
        fan_mode: FanSpeed.Auto, // Device reports Auto instead of Medium
        swing_mode: 'Off',
        opt_turbo: PowerState.Off,
        opt_sleepMode: SleepModeState.Off,
        opt_eco: PowerState.Off,
        opt_display: PowerState.On,
        outdoor_temp: 30,
      };
      
      deviceState.updateFromDevice(deviceStatus);
      
      // Fan speed should be Auto but we should NOT see the rejection message
      expect(deviceState.fanSpeed).toBe(FanSpeed.Auto);
      expect(mockPlatform.log.debug).not.toHaveBeenCalledWith(
        expect.stringContaining('Medium was rejected by AC, adopting Auto')
      );
      
      // Reset timers
      vi.useRealTimers();
    });

    it('should properly handle fan speed rejection in subsequent device updates', () => {
      // Use fake timers for this test
      vi.useFakeTimers();
      
      // Ensure device is powered on first
      deviceState.setPower(PowerState.On);
      deviceState.setOperationMode(OperationMode.Cool);
      
      // Set fan speed to Medium
      deviceState.setFanSpeed(FanSpeed.Medium);
      expect(deviceState.fanSpeed).toBe(FanSpeed.Medium);
      
      // Mock a device update where device reports Auto instead of Medium
      const deviceStatus: AirConditionerStatus = {
        is_on: PowerState.On,
        operation_mode: OperationMode.Cool,
        target_temp: 22,
        current_temp: 24,
        fan_mode: FanSpeed.Auto, // Device reports Auto instead of Medium
        swing_mode: 'Off',
        opt_turbo: PowerState.Off,
        opt_sleepMode: SleepModeState.Off,
        opt_eco: PowerState.Off,
        opt_display: PowerState.On,
        outdoor_temp: 30,
      };
      
      // First update (within window) - this should reset _lastFanSpeedCmdTime
      vi.advanceTimersByTime(3000);
      deviceState.updateFromDevice(deviceStatus);
      
      // Clear logs for the second test
      vi.clearAllMocks();
      
      // Second update - should not show rejection message
      deviceState.updateFromDevice(deviceStatus);
      
      // Check if any debug message includes our Medium rejection message
      const debugCalls = mockPlatform.log.debug.mock.calls;
      const hasRejectionMessage = debugCalls.some(call => 
        typeof call[0] === 'string' && call[0].includes('Medium was rejected by AC')
      );
      
      // We should NOT see the rejection message
      expect(hasRejectionMessage).toBe(false);
      
      // Reset timers
      vi.useRealTimers();
    });
  });

  describe('Existing functionality preservation', () => {
    it('should still protect against turbo transient states', () => {
      // Ensure device is powered on first
      deviceState.setPower(PowerState.On);
      
      // Start with turbo OFF
      deviceState.setTurboMode(PowerState.Off);
      expect(deviceState.turboMode).toBe(PowerState.Off);
      
      // Turn turbo ON (this should record the timestamp)
      deviceState.setTurboMode(PowerState.On);
      expect(deviceState.turboMode).toBe(PowerState.On);
      
      // Simulate device reporting turbo OFF within 5 seconds (spurious deactivation)
      const deviceStatus: AirConditionerStatus = {
        is_on: PowerState.On,
        operation_mode: OperationMode.Cool,
        target_temp: 22,
        current_temp: 24,
        fan_mode: FanSpeed.Auto,
        swing_mode: 'Off',
        opt_turbo: PowerState.Off, // This should be ignored due to recent turbo-on
        opt_sleepMode: SleepModeState.Off,
        opt_eco: PowerState.Off,
        opt_display: PowerState.On,
        outdoor_temp: 30,
      };
      
      deviceState.updateFromDevice(deviceStatus);
      
      // Turbo mode should remain ON (transient state protection)
      expect(deviceState.turboMode).toBe(PowerState.On);
      expect(mockPlatform.log.debug).toHaveBeenCalledWith(
        expect.stringContaining('Ignoring intermediate off state for turbo mode during transition')
      );
    });
  });
});
