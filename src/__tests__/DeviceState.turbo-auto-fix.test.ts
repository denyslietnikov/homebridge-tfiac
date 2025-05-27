import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceState } from '../state/DeviceState';
import { PowerState, FanSpeed } from '../enums';
import { Logger } from 'homebridge';

describe('DeviceState TFIAC Turbo Auto Fix - Turbo Mode Fan Speed Handling', () => {
  let deviceState: DeviceState;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    deviceState = new DeviceState(mockLogger);
  });

  it('should treat Auto fan speed as Turbo when opt_turbo is ON (TFIAC protocol fix)', () => {
    // Power on the device first (required for turbo mode to work)
    deviceState.updateFromDevice({
      is_on: 'on',
    });
    
    // Set initial state with Turbo mode ON
    deviceState.updateFromDevice({
      is_on: 'on',
      opt_turbo: PowerState.On,
      fan_mode: FanSpeed.Turbo,
    });
    
    expect(deviceState.fanSpeed).toBe(FanSpeed.Turbo);
    expect(deviceState.turboMode).toBe(PowerState.On);

    // Simulate device poll response where TFIAC reports Auto while turbo is actually ON
    // This is the exact scenario described in the TFIAC protocol issue
    deviceState.updateFromDevice({
      is_on: 'on',               // Keep device ON
      opt_turbo: PowerState.On,    // Turbo is still ON
      fan_mode: FanSpeed.Auto,     // But device reports Auto (TFIAC protocol issue)
    });

    // TFIAC protocol fix should prevent the fan speed from changing to Auto
    // and keep it as Turbo since opt_turbo is ON
    expect(deviceState.fanSpeed).toBe(FanSpeed.Turbo);
    expect(deviceState.turboMode).toBe(PowerState.On);
  });

  it('should allow Auto fan speed when opt_turbo is OFF', () => {
    // Power on the device first
    deviceState.updateFromDevice({
      is_on: 'on',
    });
    
    // Set initial state with Turbo mode OFF
    deviceState.updateFromDevice({
      is_on: 'on',
      opt_turbo: PowerState.Off,
      fan_mode: FanSpeed.Auto,
    });
    
    expect(deviceState.fanSpeed).toBe(FanSpeed.Auto);
    expect(deviceState.turboMode).toBe(PowerState.Off);

    // Device reports Auto with turbo OFF - this should be accepted normally
    deviceState.updateFromDevice({
      is_on: 'on',
      opt_turbo: PowerState.Off,
      fan_mode: FanSpeed.Auto,
    });

    expect(deviceState.fanSpeed).toBe(FanSpeed.Auto);
    expect(deviceState.turboMode).toBe(PowerState.Off);
  });

  it('should enforce harmonization rules when opt_turbo is ON', () => {
    // Power on the device first
    deviceState.updateFromDevice({
      is_on: 'on',
    });
    
    // Set initial state with Turbo mode ON
    deviceState.updateFromDevice({
      is_on: 'on',
      opt_turbo: PowerState.On,
      fan_mode: FanSpeed.Turbo,
    });
    
    expect(deviceState.fanSpeed).toBe(FanSpeed.Turbo);

    // When device reports a different fan speed while turbo is ON,
    // harmonization Rule R3 should force fanSpeed back to Turbo
    deviceState.updateFromDevice({
      is_on: 'on',
      opt_turbo: PowerState.On,
      fan_mode: FanSpeed.High,
    });

    // Rule R3: When turboMode is ON, fanSpeed must be Turbo (harmonization)
    expect(deviceState.fanSpeed).toBe(FanSpeed.Turbo);
    expect(deviceState.turboMode).toBe(PowerState.On);
  });

  it('should handle transition from Turbo to Auto when turbo is turned OFF', () => {
    // Power on the device first
    deviceState.updateFromDevice({
      is_on: 'on',
    });
    
    // Start with Turbo mode ON
    deviceState.updateFromDevice({
      is_on: 'on',
      opt_turbo: PowerState.On,
      fan_mode: FanSpeed.Turbo,
    });
    
    expect(deviceState.fanSpeed).toBe(FanSpeed.Turbo);
    expect(deviceState.turboMode).toBe(PowerState.On);

    // Turn turbo OFF and device reports Auto - this should be accepted
    deviceState.updateFromDevice({
      is_on: 'on',
      opt_turbo: PowerState.Off,
      fan_mode: FanSpeed.Auto,
    });

    expect(deviceState.fanSpeed).toBe(FanSpeed.Auto);
    expect(deviceState.turboMode).toBe(PowerState.Off);
  });

  it('should log appropriate message when TFIAC turbo fix is applied', () => {
    // Enable debug mode to see the log message
    deviceState.setDebugEnabled(true);

    // Power on the device first
    deviceState.updateFromDevice({
      is_on: 'on',
    });

    // Set initial state with AUTO fan speed (not Turbo)
    deviceState.updateFromDevice({
      is_on: 'on',
      opt_turbo: PowerState.Off,
      fan_mode: FanSpeed.Auto,
    });

    // Clear previous log calls
    vi.clearAllMocks();

    // Now trigger the TFIAC turbo protocol issue by turning turbo ON while device reports Auto
    // This should trigger the protocol fix and change fanSpeed from Auto to Turbo
    deviceState.updateFromDevice({
      is_on: 'on',
      opt_turbo: PowerState.On,     // Turbo is now ON
      fan_mode: FanSpeed.Auto,      // But device still reports Auto (TFIAC bug)
    });

    // Verify the fix was applied and appropriate message was logged
    expect(deviceState.fanSpeed).toBe(FanSpeed.Turbo);
    
    // Check that the specific log message for the TFIAC turbo fix was generated
    const debugLogCalls = (mockLogger.debug as any).mock.calls;
    
    const turboFixLogFound = debugLogCalls.some((call: any[]) => 
      call[0]?.includes?.('Fan speed (turbo mode active, ignoring Auto from device) updated')
    );
    expect(turboFixLogFound).toBe(true);
  });
});
