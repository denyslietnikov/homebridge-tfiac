import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeviceState } from '../state/DeviceState';
import { PowerState, SleepModeState, OperationMode, FanSpeed } from '../enums';
import { SleepSwitchAccessory } from '../SleepSwitchAccessory';
import { TurboSwitchAccessory } from '../TurboSwitchAccessory';
import { TfiacPlatform } from '../platform';
import { Logger } from 'homebridge';

/**
 * Test Suite: Sleep and Turbo Mutual Exclusion
 * 
 * This test suite verifies that Sleep and Turbo modes cannot be enabled simultaneously,
 * ensuring the mutual exclusion checks work correctly at both the DeviceState level
 * and the Accessory level.
 */
describe('Sleep and Turbo Mutual Exclusion', () => {
  let deviceState: DeviceState;
  let mockLogger: Logger;
  let mockPlatform: TfiacPlatform;

  beforeEach(() => {
    // Mock logger
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as any;

    // Mock platform
    mockPlatform = {
      log: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      api: {
        hap: {
          HAPStatus: {
            SERVICE_COMMUNICATION_FAILURE: -70402,
          },
          HapStatusError: class HapStatusError extends Error {
            constructor(public hapStatus: number) {
              super();
              this.status = hapStatus;
            }
            status: number;
          }
        },
      },
      // Add characteristic types needed by BaseSwitchAccessory
      Characteristic: {
        Name: 'Name',
        On: 'On',
        ConfiguredName: 'ConfiguredName',
      },
      Service: {
        Switch: class Switch {
          constructor(public name: string, public subtype: string) {}
          static UUID = 'switch-uuid';
        },
      },
    } as any;

    deviceState = new DeviceState(mockLogger, true); // Enable debug for detailed logs
  });

  describe('DeviceState Level Mutual Exclusion', () => {
    it('should turn off Turbo when Sleep is enabled', () => {
      // Setup: Device is on, Turbo is active
      deviceState.setPower(PowerState.On);
      deviceState.setOperationMode(OperationMode.Cool);
      deviceState.setTurboMode(PowerState.On);
      
      expect(deviceState.turboMode).toBe(PowerState.On);
      expect(deviceState.fanSpeed).toBe(FanSpeed.Turbo);
      expect(deviceState.sleepMode).toBe(SleepModeState.Off);
      
      // Action: Enable Sleep mode
      deviceState.setSleepMode(SleepModeState.On);
      
      // Verify: Turbo should be off, Sleep should be on
      expect(deviceState.sleepMode).toBe(SleepModeState.On);
      expect(deviceState.turboMode).toBe(PowerState.Off);
      expect(deviceState.fanSpeed).toBe(FanSpeed.Low);
    });

    it('should turn off Sleep when Turbo is enabled', () => {
      // Setup: Device is on, Sleep is active
      deviceState.setPower(PowerState.On);
      deviceState.setOperationMode(OperationMode.Cool);
      deviceState.setSleepMode(SleepModeState.On);
      
      expect(deviceState.sleepMode).toBe(SleepModeState.On);
      expect(deviceState.fanSpeed).toBe(FanSpeed.Low);
      expect(deviceState.turboMode).toBe(PowerState.Off);
      
      // Action: Enable Turbo mode
      deviceState.setTurboMode(PowerState.On);
      
      // Verify: Sleep should be off, Turbo should be on
      expect(deviceState.turboMode).toBe(PowerState.On);
      expect(deviceState.sleepMode).toBe(SleepModeState.Off);
      expect(deviceState.fanSpeed).toBe(FanSpeed.Turbo);
    });

    it('should prevent Sleep activation during recent turbo-off transition (within 5 seconds)', () => {
      // Use fake timers to control time
      vi.useFakeTimers();

      // Setup: Device is on, Turbo is active
      deviceState.setPower(PowerState.On);
      deviceState.setOperationMode(OperationMode.Cool);
      deviceState.setTurboMode(PowerState.On);
      
      // Turn off Turbo (this sets the lastTurboOffTime)
      deviceState.setTurboMode(PowerState.Off);
      expect(deviceState.turboMode).toBe(PowerState.Off);
      
      // Immediately try to activate Sleep (within 5 seconds)
      deviceState.setSleepMode(SleepModeState.On);
      
      // Sleep should NOT be activated due to recent turbo-off
      expect(deviceState.sleepMode).toBe(SleepModeState.Off);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Delaying sleep mode activation due to recent turbo-off')
      );
      
      // Fast-forward time by 6 seconds
      vi.advanceTimersByTime(6000);
      
      // Now Sleep activation should work
      deviceState.setSleepMode(SleepModeState.On);
      expect(deviceState.sleepMode).toBe(SleepModeState.On);
      
      vi.useRealTimers();
    });
  });

  describe('SleepSwitchAccessory Level Protection', () => {
    it('should prevent Sleep activation when Turbo is currently active', async () => {
      // Create a mock cache manager that uses our shared deviceState
      const mockCacheManager = {
        applyStateToDevice: vi.fn(),
        getDeviceState: vi.fn().mockReturnValue(deviceState),
      } as any;

      // Create a mock accessory with cache manager in context
      const mockAccessory = {
        context: {
          deviceConfig: { 
            ip: '192.168.1.100',
            port: 8080, 
            name: 'Test AC Sleep',
            uiHoldSeconds: 5
          },
          cacheManager: mockCacheManager, // Provide cache manager in context
        },
        displayName: 'Test AC Sleep Display',
        getService: vi.fn().mockReturnValue(null),
        getServiceById: vi.fn().mockReturnValue(null),
        addService: vi.fn().mockReturnValue({
          setCharacteristic: vi.fn().mockReturnThis(),
          getCharacteristic: vi.fn().mockReturnValue({
            onGet: vi.fn().mockReturnThis(),
            onSet: vi.fn().mockReturnThis(),
            updateValue: vi.fn(),
            value: false,
          }),
          updateCharacteristic: vi.fn(),
        }),
      } as any;

      // Setup DeviceState with Turbo active
      deviceState.setPower(PowerState.On);
      deviceState.setOperationMode(OperationMode.Cool);
      deviceState.setTurboMode(PowerState.On);
      
      expect(deviceState.turboMode).toBe(PowerState.On);
      expect(deviceState.power).toBe(PowerState.On);

      // Create SleepSwitchAccessory
      const sleepAccessory = new SleepSwitchAccessory(mockPlatform, mockAccessory);

      // Get the handleSet method using type casting to access protected method
      const handleSet = (sleepAccessory as any).handleSet.bind(sleepAccessory);
      
      // Mock callback
      const mockCallback = vi.fn();
      
      // Try to enable Sleep while Turbo is active
      await handleSet(true, mockCallback);
      
      // Verify that the operation was rejected
      expect(mockPlatform.log.info).toHaveBeenCalledWith(
        expect.stringContaining('Cannot enable Sleep while Turbo is active')
      );
      expect(mockCacheManager.applyStateToDevice).not.toHaveBeenCalled();
      expect(mockCallback).toHaveBeenCalledWith(expect.objectContaining({ 
        status: expect.any(Number) 
      }));
      
      // Device state should remain unchanged
      expect(deviceState.sleepMode).toBe(SleepModeState.Off);
      expect(deviceState.turboMode).toBe(PowerState.On);
    });

    it('should allow Sleep activation when Turbo is not active', async () => {
      // Create a mock cache manager that uses our shared deviceState
      const mockCacheManager = {
        applyStateToDevice: vi.fn().mockResolvedValue(undefined),
        getDeviceState: vi.fn().mockReturnValue(deviceState),
      } as any;

      // Create a mock accessory with cache manager in context
      const mockAccessory = {
        context: {
          deviceConfig: { 
            ip: '192.168.1.100',
            port: 8080, 
            name: 'Test AC Sleep',
            uiHoldSeconds: 5
          },
          cacheManager: mockCacheManager, // Provide cache manager in context
        },
        displayName: 'Test AC Sleep Display',
        getService: vi.fn().mockReturnValue(null),
        getServiceById: vi.fn().mockReturnValue(null),
        addService: vi.fn().mockReturnValue({
          setCharacteristic: vi.fn().mockReturnThis(),
          getCharacteristic: vi.fn().mockReturnValue({
            onGet: vi.fn().mockReturnThis(),
            onSet: vi.fn().mockReturnThis(),
            updateValue: vi.fn(),
            value: false,
          }),
          updateCharacteristic: vi.fn(),
        }),
      } as any;

      // Setup DeviceState with Turbo inactive
      deviceState.setPower(PowerState.On);
      deviceState.setOperationMode(OperationMode.Cool);
      expect(deviceState.turboMode).toBe(PowerState.Off);
      expect(deviceState.power).toBe(PowerState.On);

      // Create SleepSwitchAccessory
      const sleepAccessory = new SleepSwitchAccessory(mockPlatform, mockAccessory);

      // Get the handleSet method using type casting to access protected method
      const handleSet = (sleepAccessory as any).handleSet.bind(sleepAccessory);
      
      // Mock callback
      const mockCallback = vi.fn();
      
      // Enable Sleep when Turbo is not active
      await handleSet(true, mockCallback);
      
      // Verify that the operation was accepted
      expect(mockPlatform.log.info).not.toHaveBeenCalledWith(
        expect.stringContaining('Cannot enable Sleep while Turbo is active')
      );
      expect(mockCacheManager.applyStateToDevice).toHaveBeenCalledWith(expect.any(Object));
      expect(mockCallback).toHaveBeenCalledWith(null);
      
      // Verify the cloned state that was passed to applyStateToDevice has Sleep enabled
      const applyStateCall = mockCacheManager.applyStateToDevice.mock.calls[0];
      const appliedState = applyStateCall[0];
      expect(appliedState.sleepMode).toBe(SleepModeState.On);
    });
  });

  describe('TurboSwitchAccessory Level Protection', () => {
    it('should prevent Turbo activation when Sleep is currently active', async () => {
      // Create a mock cache manager that uses our shared deviceState
      const mockCacheManager = {
        applyStateToDevice: vi.fn(),
        getDeviceState: vi.fn().mockReturnValue(deviceState),
      } as any;

      // Create a mock accessory with cache manager in context
      const mockAccessory = {
        context: {
          deviceConfig: { 
            ip: '192.168.1.100',
            port: 8080, 
            name: 'Test AC Turbo',
            uiHoldSeconds: 5
          },
          cacheManager: mockCacheManager, // Provide cache manager in context
        },
        displayName: 'Test AC Turbo Display',
        getService: vi.fn().mockReturnValue(null),
        getServiceById: vi.fn().mockReturnValue(null),
        addService: vi.fn().mockReturnValue({
          setCharacteristic: vi.fn().mockReturnThis(),
          getCharacteristic: vi.fn().mockReturnValue({
            onGet: vi.fn().mockReturnThis(),
            onSet: vi.fn().mockReturnThis(),
            updateValue: vi.fn(),
            value: false,
          }),
          updateCharacteristic: vi.fn(),
        }),
      } as any;

      // Setup DeviceState with Sleep active
      deviceState.setPower(PowerState.On);
      deviceState.setOperationMode(OperationMode.Cool);
      deviceState.setSleepMode(SleepModeState.On);
      
      expect(deviceState.sleepMode).toBe(SleepModeState.On);
      expect(deviceState.power).toBe(PowerState.On);

      // Create TurboSwitchAccessory
      const turboAccessory = new TurboSwitchAccessory(mockPlatform, mockAccessory);

      // Get the handleSet method using type casting to access protected method
      const handleSet = (turboAccessory as any).handleSet.bind(turboAccessory);
      
      // Mock callback
      const mockCallback = vi.fn();
      
      // Try to enable Turbo while Sleep is active
      await handleSet(true, mockCallback);
      
      // Verify that the operation was rejected
      expect(mockPlatform.log.info).toHaveBeenCalledWith(
        expect.stringContaining('Cannot enable Turbo while Sleep is active')
      );
      expect(mockCacheManager.applyStateToDevice).not.toHaveBeenCalled();
      expect(mockCallback).toHaveBeenCalledWith(expect.objectContaining({ 
        status: expect.any(Number) 
      }));
      
      // Device state should remain unchanged
      expect(deviceState.turboMode).toBe(PowerState.Off);
      expect(deviceState.sleepMode).toBe(SleepModeState.On);
    });

    it('should allow Turbo activation when Sleep is not active', async () => {
      // Create a mock cache manager that uses our shared deviceState
      const mockCacheManager = {
        applyStateToDevice: vi.fn().mockResolvedValue(undefined),
        getDeviceState: vi.fn().mockReturnValue(deviceState),
      } as any;

      // Create a mock accessory with cache manager in context
      const mockAccessory = {
        context: {
          deviceConfig: { 
            ip: '192.168.1.100',
            port: 8080, 
            name: 'Test AC Turbo',
            uiHoldSeconds: 5
          },
          cacheManager: mockCacheManager, // Provide cache manager in context
        },
        displayName: 'Test AC Turbo Display',
        getService: vi.fn().mockReturnValue(null),
        getServiceById: vi.fn().mockReturnValue(null),
        addService: vi.fn().mockReturnValue({
          setCharacteristic: vi.fn().mockReturnThis(),
          getCharacteristic: vi.fn().mockReturnValue({
            onGet: vi.fn().mockReturnThis(),
            onSet: vi.fn().mockReturnThis(),
            updateValue: vi.fn(),
            value: false,
          }),
          updateCharacteristic: vi.fn(),
        }),
      } as any;

      // Setup DeviceState with Sleep inactive
      deviceState.setPower(PowerState.On);
      deviceState.setOperationMode(OperationMode.Cool);
      expect(deviceState.sleepMode).toBe(SleepModeState.Off);
      expect(deviceState.power).toBe(PowerState.On);

      // Create TurboSwitchAccessory
      const turboAccessory = new TurboSwitchAccessory(mockPlatform, mockAccessory);

      // Get the handleSet method using type casting to access protected method
      const handleSet = (turboAccessory as any).handleSet.bind(turboAccessory);
      
      // Mock callback
      const mockCallback = vi.fn();
      
      // Enable Turbo when Sleep is not active
      await handleSet(true, mockCallback);
      
      // Verify that the operation was accepted
      expect(mockPlatform.log.info).not.toHaveBeenCalledWith(
        expect.stringContaining('Cannot enable Turbo while Sleep is active')
      );
      expect(mockCacheManager.applyStateToDevice).toHaveBeenCalledWith(expect.any(Object));
      expect(mockCallback).toHaveBeenCalledWith(null);
      
      // Verify the cloned state that was passed to applyStateToDevice has the correct values
      const applyStateCall = mockCacheManager.applyStateToDevice.mock.calls[0];
      const appliedState = applyStateCall[0];
      expect(appliedState.turboMode).toBe(PowerState.On);
      expect(appliedState.sleepMode).toBe(SleepModeState.Off); // Sleep should be turned off by Turbo
    });
  });

  describe('Edge Cases and Race Conditions', () => {
    it('should handle simultaneous requests correctly', async () => {
      // Setup: Device is on, both modes are off
      deviceState.setPower(PowerState.On);
      deviceState.setOperationMode(OperationMode.Cool);
      
      expect(deviceState.turboMode).toBe(PowerState.Off);
      expect(deviceState.sleepMode).toBe(SleepModeState.Off);

      // Test: Enable Turbo first, then immediately try Sleep
      deviceState.setTurboMode(PowerState.On);
      expect(deviceState.turboMode).toBe(PowerState.On);
      
      // This should work through the DeviceState harmonization
      deviceState.setSleepMode(SleepModeState.On);
      
      // Final state: Sleep should win and Turbo should be off
      expect(deviceState.sleepMode).toBe(SleepModeState.On);
      expect(deviceState.turboMode).toBe(PowerState.Off);
    });

    it('should handle device updates during transitions', () => {
      // Setup: Turbo is active
      deviceState.setPower(PowerState.On);
      deviceState.setTurboMode(PowerState.On);
      
      // Simulate device update that shows Sleep as active (shouldn't happen in reality)
      // This tests that our validation catches inconsistent device states
      const deviceUpdate = {
        is_on: PowerState.On,
        operation_mode: OperationMode.Cool,
        target_temp: 22,
        current_temp: 25,
        fan_mode: FanSpeed.Auto,
        swing_mode: 'Off',
        opt_turbo: PowerState.On,
        opt_sleepMode: SleepModeState.On, // This contradicts turbo being on
        opt_eco: PowerState.Off,
        opt_display: PowerState.On,
      };
      
      deviceState.updateFromDevice(deviceUpdate);
      
      // The harmonization should resolve this conflict
      // Turbo should take precedence over conflicting sleep state from device
      expect(deviceState.turboMode).toBe(PowerState.On);
      expect(deviceState.sleepMode).toBe(SleepModeState.Off);
    });
  });
});
