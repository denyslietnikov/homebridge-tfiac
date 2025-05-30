import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import CacheManager from '../CacheManager.js';
import { TfiacDeviceConfig } from '../settings.js';
import { PowerState, OperationMode, FanSpeed, SleepModeState } from '../enums.js';
import { DeviceState } from '../state/DeviceState.js';

// We'll no longer mock CommandQueue module, but instead directly mock the initCommandQueue method
class MockEventEmitter extends EventEmitter {
  public enqueueCommand = vi.fn().mockResolvedValue(undefined);
  public removeAllListeners = vi.fn();
}

describe('CacheManager - Additional Tests', () => {
  let cacheManager: CacheManager;
  let config: TfiacDeviceConfig;
  let mockApi: any;
  let mockDeviceState: any;
  let mockCommandQueue: MockEventEmitter;
  
  const originalNodeEnv = process.env.NODE_ENV;
  
  beforeEach(async () => {
    vi.clearAllMocks();
    
    process.env.NODE_ENV = 'test';
    
    config = {
      name: 'Test AC',
      ip: '192.168.1.100',
      port: 8080,
      updateInterval: 15,
      debug: true,
    } as TfiacDeviceConfig;
    
    cacheManager = CacheManager.getInstance(config);

    const actualDeviceStateModule = await vi.importActual('../state/DeviceState.js') as { DeviceState: any };
    mockDeviceState = new actualDeviceStateModule.DeviceState();
    
    mockApi = {
      updateState: vi.fn().mockResolvedValue({ is_on: 'on', current_temp: 25 }),
      emit: vi.fn(),
      on: vi.fn(),
      removeAllListeners: vi.fn(),
      cleanup: vi.fn(),
      setDeviceOptions: vi.fn().mockResolvedValue(undefined),
    };

    // Create a new MockEventEmitter instance for each test
    mockCommandQueue = new MockEventEmitter();

    // Configure the mock enqueueCommand to also call the API
    mockCommandQueue.enqueueCommand = vi.fn().mockImplementation(async (command) => {
      // Call the API with the command to simulate the real CommandQueue behavior
      await mockApi.setDeviceOptions(command);
      return undefined;
    });

    // Instead of completely mocking initCommandQueue, we need to preserve the event listener setup logic.
    // First, store the original method
    const originalInitCommandQueue = (cacheManager as any).initCommandQueue;
    
    // Then mock it to:
    // 1. Return our mockCommandQueue
    // 2. But still set up event listeners on it similar to the original method
    (cacheManager as any).initCommandQueue = vi.fn(() => {
      // Set up the command queue reference
      (cacheManager as any).commandQueue = mockCommandQueue;
      
      // Set up the executed event listener to schedule a quick refresh
      mockCommandQueue.on('executed', (event: any) => {
        (cacheManager as any).logger.debug(`[CacheManager] Command executed: ${JSON.stringify(event.command)}. Scheduling quick refresh.`);
        (cacheManager as any).scheduleQuickRefresh();
      });
      
      // We'll skip other event listeners for now as they're not relevant to this test
      
      return mockCommandQueue;
    });

    (cacheManager as any).api = mockApi;
    (cacheManager as any)._deviceState = mockDeviceState;
    (cacheManager as any).isUpdating = false;
    (cacheManager as any).logger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  });
  
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('updateDeviceState', () => {
    it('should update device state successfully', async () => {
      const mockStatus = { 
        is_on: PowerState.On, 
        operation_mode: OperationMode.Cool,
        target_temp: 22, 
        current_temp: 23,
        fan_mode: FanSpeed.Auto,
      };
      mockApi.updateState.mockResolvedValueOnce(mockStatus);
      
      const updateFromDeviceSpy = vi.spyOn(mockDeviceState, 'updateFromDevice').mockReturnValueOnce(true);
      
      const result = await cacheManager.updateDeviceState();
      
      expect(result).toBe(mockDeviceState);
      expect(mockApi.updateState).toHaveBeenCalled();
      expect(updateFromDeviceSpy).toHaveBeenCalledWith(mockStatus);
      expect((cacheManager as any).rawApiCache).toBe(mockStatus);
      expect((cacheManager as any).lastFetch).toBeGreaterThan(0);
      expect((cacheManager as any).consecutiveFailedPolls).toBe(0);
    });

    it('should handle failed API update', async () => {
      mockApi.updateState.mockResolvedValueOnce(null);
      
      const result = await cacheManager.updateDeviceState();
      
      expect(result).toBe(mockDeviceState);
      expect((cacheManager as any).consecutiveFailedPolls).toBe(1);
      expect((cacheManager as any).logger.warn).toHaveBeenCalled();
    });

    it('should degrade polling after max consecutive failures', async () => {
      (cacheManager as any).consecutiveFailedPolls = (cacheManager as any).maxConsecutiveFailedPolls - 1;
      
      mockApi.updateState.mockResolvedValueOnce(null);
      
      await cacheManager.updateDeviceState();
      
      expect((cacheManager as any).isPollingDegraded).toBe(true);
      expect((cacheManager as any).ttl).toBe((cacheManager as any).degradedTtl);
    });

    it('should handle errors during API update', async () => {
      const error = new Error('Network error');
      mockApi.updateState.mockRejectedValueOnce(error);
      
      await expect(cacheManager.updateDeviceState()).resolves.toBe(mockDeviceState);
      
      expect((cacheManager as any).logger.error).toHaveBeenCalled();
      expect((cacheManager as any).consecutiveFailedPolls).toBe(1);
    });

    it('should schedule refresh after update', async () => {
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
      
      await cacheManager.updateDeviceState();
      
      expect(setTimeoutSpy).toHaveBeenCalled();
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), (cacheManager as any).ttl);
    });

    it('should not update if update already in progress', async () => {
      (cacheManager as any).isUpdating = true;
      
      const result = await cacheManager.updateDeviceState();
      
      expect(result).toBe(mockDeviceState);
      expect(mockApi.updateState).not.toHaveBeenCalled();
      expect((cacheManager as any).logger.debug).toHaveBeenCalled();
    });
  });

  describe('applyStateToDevice', () => {
    it('should apply changes to device', async () => {
      vi.useFakeTimers();

      const desiredState = new DeviceState();
      desiredState.setPower(PowerState.On);
      desiredState.setOperationMode(OperationMode.Cool);
      desiredState.setTargetTemperature(24);
      
      const updateDeviceStateSpy = vi.spyOn(cacheManager, 'updateDeviceState').mockResolvedValue(mockDeviceState as any);
      
      // Mock scheduleQuickRefresh to directly call updateDeviceState(true) instead of using timers
      const scheduleQuickRefreshSpy = vi.spyOn(cacheManager as any, 'scheduleQuickRefresh').mockImplementation(() => {
        return cacheManager.updateDeviceState(true);
      });
      
      // Now applyStateToDevice will use our mocked initCommandQueue which returns mockCommandQueue
      await (cacheManager as any).applyStateToDevice(desiredState);
      
      // Check if command was enqueued to the mock queue
      expect(mockCommandQueue.enqueueCommand).toHaveBeenCalled();
      
      // Simulate successful execution by emitting the 'executed' event from the mockCommandQueue
      mockCommandQueue.emit('executed', { command: {}, success: true });
      
      // Since we mocked scheduleQuickRefresh to directly call updateDeviceState(true), we don't need to advance timers
      // Let's verify scheduleQuickRefresh was called (which would call updateDeviceState(true) immediately)
      expect(scheduleQuickRefreshSpy).toHaveBeenCalled();
      
      // Then verify updateDeviceState was called with true
      expect(updateDeviceStateSpy).toHaveBeenCalledWith(true);
      expect((cacheManager as any).logger.info).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should not apply changes if no differences and no harmonization needed', async () => {
      vi.spyOn(cacheManager, 'updateDeviceState').mockResolvedValueOnce(mockDeviceState);
      
      // Set up state where no harmonization is needed (not both turbo/sleep off with auto fan)
      mockDeviceState.setTurboMode(PowerState.On); // Turbo is on, so no harmonization needed
      mockDeviceState.setFanSpeed(FanSpeed.Medium);
      
      await (cacheManager as any).applyStateToDevice(mockDeviceState);
      
      expect((cacheManager as any).logger.info).toHaveBeenCalledWith('[CacheManager] No changes to apply and no harmonization needed.');
    });

    it('should apply harmonization when no direct changes but harmonization needed', async () => {
      vi.spyOn(cacheManager, 'updateDeviceState').mockResolvedValueOnce(mockDeviceState);
      
      // Set up the cached state to have the harmonization condition without triggering harmonization
      // We need to bypass the normal setters that trigger harmonization
      (mockDeviceState as any)._power = PowerState.On;
      (mockDeviceState as any)._turboMode = PowerState.Off;
      (mockDeviceState as any)._sleepMode = SleepModeState.Off;
      (mockDeviceState as any)._fanSpeed = FanSpeed.Auto;
      
      // Create a desired state that's identical to current (so no changes detected by diff)
      const desiredState = mockDeviceState.clone();
      
      // Mock updateFromOptions to simulate the harmonization behavior
      // This should change fanSpeed from Auto to Medium when harmonization options are applied
      const originalUpdateFromOptions = mockDeviceState.updateFromOptions;
      mockDeviceState.updateFromOptions = vi.fn().mockImplementation((options: any) => {
        // If we're being called with fanSpeed: Auto specifically for harmonization
        if (options.fanSpeed === FanSpeed.Auto &&
            mockDeviceState.power === PowerState.On &&
            mockDeviceState.turboMode === PowerState.Off &&
            mockDeviceState.sleepMode === SleepModeState.Off) {
          // Simulate the harmonization rule changing fan speed from Auto to Medium
          (mockDeviceState as any)._fanSpeed = FanSpeed.Medium;
          return true; // Indicate a change was made by harmonization
        }
        return originalUpdateFromOptions.call(mockDeviceState, options);
      });
      
      await (cacheManager as any).applyStateToDevice(desiredState);
      
      expect((cacheManager as any).logger.info).toHaveBeenCalledWith('[CacheManager] Harmonization check: Fan speed changed from Auto to Medium to prevent device firmware bug.');
      expect(mockApi.setDeviceOptions).toHaveBeenCalledWith(expect.objectContaining({
        fanSpeed: FanSpeed.Medium
      }));
    });
  });

  describe('updateCache', () => {
    it('should update internal cache and device state', async () => {
      const newStatus = { 
        is_on: PowerState.On, 
        operation_mode: OperationMode.Cool, 
        target_temp: 22 
      };
      
      const updateFromDeviceSpy = vi.spyOn(mockDeviceState, 'updateFromDevice');
      
      await cacheManager.updateCache('device-id', newStatus);
      
      expect((cacheManager as any).rawApiCache).toEqual(newStatus);
      expect(updateFromDeviceSpy).toHaveBeenCalledWith(newStatus);
    });
  });

  describe('scheduling and timers', () => {
    it('should schedule a quick refresh', () => {
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
      
      (cacheManager as any).scheduleQuickRefresh();
      
      expect(setTimeoutSpy).toHaveBeenCalledWith(
        expect.any(Function), 
        (cacheManager as any).quickRefreshDelayMs
      );
      
      expect((cacheManager as any).quickRefreshTimer).toBeDefined();
    });

    it('should clear existing timer when scheduling a quick refresh', () => {
      const fakeTimer = setTimeout(() => {}, 1000);
      (cacheManager as any).quickRefreshTimer = fakeTimer;
      
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      
      (cacheManager as any).scheduleQuickRefresh();
      
      expect(clearTimeoutSpy).toHaveBeenCalledWith(fakeTimer);
    });

    it('should schedule a regular refresh', () => {
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
      
      (cacheManager as any).scheduleRefresh();
      
      expect(setTimeoutSpy).toHaveBeenCalledWith(
        expect.any(Function), 
        (cacheManager as any).ttl
      );
      
      expect((cacheManager as any).pollingTimer).toBeDefined();
    });

    it('should clear existing timer when scheduling a regular refresh', () => {
      const fakeTimer = setTimeout(() => {}, 1000);
      (cacheManager as any).pollingTimer = fakeTimer;
      
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      
      (cacheManager as any).scheduleRefresh();
      
      expect(clearTimeoutSpy).toHaveBeenCalledWith(fakeTimer);
    });
  });
});
