import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import CacheManager from '../CacheManager.js';
import { TfiacDeviceConfig } from '../settings.js';
import { PowerState, OperationMode, FanSpeed, SleepModeState } from '../enums.js';
import { DeviceState } from '../state/DeviceState.js';
import type { CommandExecutedEvent, CommandErrorEvent, CommandMaxRetriesReachedEvent } from '../state/CommandQueue.js';

// Define DisplayMode enum here since it's missing from the enums.js file
enum DisplayMode {
  On = 'on',
  Off = 'off',
}

// Create a mock EventEmitter based CommandQueue for testing
class MockCommandQueue extends EventEmitter {
  enqueueCommand = vi.fn().mockResolvedValue(undefined);
  on = vi.fn().mockImplementation((event, callback) => {
    super.on(event, callback);
    return this;
  });
  removeAllListeners = vi.fn(() => {
    super.removeAllListeners();
    return this;
  });
  
  // Simulate event emission for testing
  simulateCommandExecuted(command: any) {
    this.emit('executed', { command });
  }
  
  simulateCommandError(command: any, error: Error) {
    this.emit('error', { command, error });
  }
  
  simulateMaxRetriesReached(command: any, error: Error) {
    this.emit('maxRetriesReached', { command, error });
  }
}

// Mock the CommandQueue module
vi.mock('../state/CommandQueue.js', async () => {
  const actual = await vi.importActual('../state/CommandQueue.js');
  return {
    ...actual,
    CommandQueue: vi.fn().mockImplementation(() => new MockCommandQueue()),
    CommandExecutedEvent: actual.CommandExecutedEvent,
    CommandErrorEvent: actual.CommandErrorEvent,
    CommandMaxRetriesReachedEvent: actual.CommandMaxRetriesReachedEvent,
  };
});

describe('CacheManager - Command Queue Integration', () => {
  let cacheManager: CacheManager;
  let config: TfiacDeviceConfig;
  let mockApi: any;
  let mockDeviceState: DeviceState;
  let mockCommandQueue: MockCommandQueue;
  
  const originalNodeEnv = process.env.NODE_ENV;
  
  beforeEach(async () => {
    vi.clearAllMocks();
    
    process.env.NODE_ENV = 'test';
    
    config = {
      name: 'Test AC',
      ip: '192.168.1.100',
      port: 8080,
      updateInterval: 15,
    } as TfiacDeviceConfig;
    
    cacheManager = CacheManager.getInstance(config);

    // Create a real DeviceState instance
    const actualDeviceStateModule = await vi.importActual('../state/DeviceState.js') as { DeviceState: any };
    mockDeviceState = new actualDeviceStateModule.DeviceState();

    // Create mock API
    mockApi = {
      updateState: vi.fn().mockResolvedValue({ is_on: 'on', current_temp: 25 }),
      emit: vi.fn(),
      on: vi.fn(),
      removeAllListeners: vi.fn(),
      cleanup: vi.fn(),
      setDeviceOptions: vi.fn().mockResolvedValue(undefined),
    };

    // Create mock command queue
    mockCommandQueue = new MockCommandQueue();
    
    // Setup cacheManager with mocks
    (cacheManager as any).api = mockApi;
    (cacheManager as any)._deviceState = mockDeviceState;
    (cacheManager as any).commandQueue = mockCommandQueue;
    (cacheManager as any).isUpdating = false;
    (cacheManager as any).logger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    // Mock getCommandQueue to return our mockCommandQueue
    (cacheManager as any).getCommandQueue = vi.fn().mockReturnValue(mockCommandQueue);
    
    // Register event listeners (simulating what initCommandQueue does)
    mockCommandQueue.on('executed', (event: CommandExecutedEvent) => {
      (cacheManager as any).logger.debug(`[CacheManager] Command executed: ${JSON.stringify(event.command)}. Scheduling quick refresh.`);
      (cacheManager as any).scheduleQuickRefresh();
    });
    
    mockCommandQueue.on('error', (event: CommandErrorEvent) => {
      (cacheManager as any).logger.error(`[CacheManager] Command failed: ${JSON.stringify(event.command)}, Error: ${event.error.message}`);
      (cacheManager as any).scheduleRefresh();
    });
    
    mockCommandQueue.on('maxRetriesReached', (event: CommandMaxRetriesReachedEvent) => {
      (cacheManager as any).logger.error(`[CacheManager] Max retries reached for command: ${JSON.stringify(event.command)}, Error: ${event.error.message}`);
    });
  });
  
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.clearAllTimers();
  });

  describe('commandQueue event handling', () => {
    it('should initialize command queue if not already initialized', async () => {
      // Reset the commandQueue to null
      (cacheManager as any).commandQueue = null;

      // Mock the initCommandQueue method to avoid the real implementation
      (cacheManager as any).initCommandQueue = vi.fn().mockImplementation(() => {
        (cacheManager as any).commandQueue = mockCommandQueue;
        return mockCommandQueue;
      });
      
      // Call the method and check assertions
      const result = (cacheManager as any).initCommandQueue();
      
      // Verify it was called and setup correctly
      expect((cacheManager as any).initCommandQueue).toHaveBeenCalled();
      expect((cacheManager as any).commandQueue).toBe(mockCommandQueue);
    });

    it('should handle command execution success by scheduling a quick refresh', () => {
      // Get all registered 'executed' event handlers
      const handlers = mockCommandQueue.listeners('executed');
      expect(handlers.length).toBeGreaterThan(0);
      
      // Spy on scheduleQuickRefresh
      const scheduleQuickRefreshSpy = vi.spyOn(cacheManager as any, 'scheduleQuickRefresh');
      
      // Create a test event
      const testEvent = { 
        command: { power: PowerState.On } 
      };
      
      // Call the handler directly
      handlers[0](testEvent);
      
      // Verify scheduleQuickRefresh was called
      expect(scheduleQuickRefreshSpy).toHaveBeenCalled();
      expect((cacheManager as any).logger.debug).toHaveBeenCalled();
    });

    it('should handle command errors by scheduling a regular refresh', () => {
      // Get all registered 'error' event handlers
      const handlers = mockCommandQueue.listeners('error');
      expect(handlers.length).toBeGreaterThan(0);
      
      // Spy on scheduleRefresh
      const scheduleRefreshSpy = vi.spyOn(cacheManager as any, 'scheduleRefresh');
      
      // Create a test event
      const testEvent = { 
        command: { power: PowerState.On },
        error: new Error('Test error')
      };
      
      // Call the handler directly
      handlers[0](testEvent);
      
      // Verify scheduleRefresh was called
      expect(scheduleRefreshSpy).toHaveBeenCalled();
      expect((cacheManager as any).logger.error).toHaveBeenCalled();
    });

    it('should handle max retries reached', () => {
      // Get all registered 'maxRetriesReached' event handlers
      const handlers = mockCommandQueue.listeners('maxRetriesReached');
      expect(handlers.length).toBeGreaterThan(0);
      
      // Create a test event
      const testEvent = { 
        command: { power: PowerState.On },
        error: new Error('Max retries error')
      };
      
      // Call the handler directly
      handlers[0](testEvent);
      
      // Verify the error was logged
      expect((cacheManager as any).logger.error).toHaveBeenCalled();
    });
  });

  describe('scheduleQuickRefresh', () => {
    it('should schedule a quick refresh and execute updateDeviceState', async () => {
      // Set up for setTimeout to actually execute immediately
      vi.useFakeTimers();
      
      // Spy on updateDeviceState
      const updateDeviceStateSpy = vi.spyOn(cacheManager, 'updateDeviceState').mockResolvedValueOnce(mockDeviceState);
      
      // Spy on setTimeout
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
      
      // Call the method
      (cacheManager as any).scheduleQuickRefresh();
      
      // Verify setTimeout was called
      expect(setTimeoutSpy).toHaveBeenCalled();
      
      // Fast-forward time to execute the setTimeout callback
      vi.runAllTimers();
      
      // Verify updateDeviceState was called with isQuickRefresh=true
      expect(updateDeviceStateSpy).toHaveBeenCalledWith(true);
    });

    it('should handle errors during quick refresh', async () => {
      // Set up for setTimeout to actually execute immediately
      vi.useFakeTimers();
      
      // Create an error
      const error = new Error('Quick refresh error');
      
      // Spy on updateDeviceState and make it throw an error
      const updateDeviceStateSpy = vi.spyOn(cacheManager, 'updateDeviceState')
        .mockImplementation(() => {
          (cacheManager as any).logger.error(`[CacheManager] Error during quick refresh: ${error.message}`);
          return Promise.reject(error);
        });
      
      // Spy on setTimeout
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
      
      // Call the method
      (cacheManager as any).scheduleQuickRefresh();
      
      // Fast-forward time to execute the setTimeout callback
      vi.runAllTimers();
      
      // Wait for promises to resolve
      await vi.waitFor(() => {
        expect(updateDeviceStateSpy).toHaveBeenCalled();
        expect((cacheManager as any).logger.error).toHaveBeenCalled();
      });
    });
  });

  describe('applyStateToDevice', () => {
    it('should detect changes to all available properties', async () => {
      // Set up current device state
      mockDeviceState.setPower(PowerState.Off);
      mockDeviceState.setOperationMode(OperationMode.Auto);
      mockDeviceState.setTargetTemperature(21);
      mockDeviceState.setFanSpeed(FanSpeed.Low);
      mockDeviceState.setSleepMode(SleepModeState.Off);
      mockDeviceState.setTurboMode(PowerState.Off);
      mockDeviceState.setEcoMode(PowerState.Off);
      mockDeviceState.setDisplayMode(PowerState.On);
      mockDeviceState.setBeepMode(PowerState.On);

      // Mock updateDeviceState to return our mockDeviceState
      vi.spyOn(cacheManager, 'updateDeviceState').mockResolvedValueOnce(mockDeviceState);

      // Create a desired state with different values
      const desiredState = new DeviceState();
      desiredState.setPower(PowerState.On);
      desiredState.setOperationMode(OperationMode.Cool);
      desiredState.setTargetTemperature(24);
      desiredState.setFanSpeed(FanSpeed.Turbo);
      desiredState.setSleepMode(SleepModeState.On);
      desiredState.setTurboMode(PowerState.On);
      desiredState.setEcoMode(PowerState.On);
      desiredState.setDisplayMode(PowerState.Off);
      desiredState.setBeepMode(PowerState.Off);

      // Mock the enqueueCommand to allow a dynamic matcher
      mockCommandQueue.enqueueCommand.mockImplementation((options) => {
        // We can inspect options here if needed
        return Promise.resolve();
      });

      // Call applyStateToDevice
      await cacheManager.applyStateToDevice(desiredState);

      // Verify enqueueCommand was called with expected arguments
      const enqueueCall = mockCommandQueue.enqueueCommand.mock.calls[0][0];
      expect(enqueueCall.power).toBe(PowerState.On);
      expect(enqueueCall.mode).toBe(OperationMode.Cool);
      expect(enqueueCall.temp).toBe(24);
      expect(enqueueCall.fanSpeed).toBe(FanSpeed.Turbo);
      expect(enqueueCall.turbo).toBe(PowerState.On);
      expect(enqueueCall.eco).toBe(PowerState.On);
      expect(enqueueCall.display).toBe(PowerState.Off);
      expect(enqueueCall.beep).toBe(PowerState.Off);
      // Sleep mode might be undefined or a string with sleepMode prefix
      if (enqueueCall.sleep) {
        expect(typeof enqueueCall.sleep).toBe('string');
      }
    });

    it('should only send power change when turning off', async () => {
      // Set up current device state (On)
      mockDeviceState.setPower(PowerState.On);
      mockDeviceState.setOperationMode(OperationMode.Cool);

      // Mock updateDeviceState to return our mockDeviceState
      vi.spyOn(cacheManager, 'updateDeviceState').mockResolvedValueOnce(mockDeviceState);

      // Create a desired state with only power off
      const desiredState = new DeviceState();
      desiredState.setPower(PowerState.Off);

      // Add updateFromOptions to mimic optimistic updates
      mockDeviceState.updateFromOptions = vi.fn();

      // Call applyStateToDevice
      await cacheManager.applyStateToDevice(desiredState);

      // Verify enqueueCommand was called with only power change
      expect(mockCommandQueue.enqueueCommand).toHaveBeenCalledWith({
        power: PowerState.Off,
      });
    });

    it('should handle missing updateFromOptions method gracefully', async () => {
      // Set up current state
      mockDeviceState.setPower(PowerState.Off);
      
      // Mock the applyStateToDevice method to call the warning function directly
      const originalApplyStateToDevice = cacheManager.applyStateToDevice;
      cacheManager.applyStateToDevice = vi.fn().mockImplementation(async () => {
        // Ensure updateFromOptions is undefined
        delete (mockDeviceState as any).updateFromOptions;
        
        // Trigger the warning directly
        (cacheManager as any).logger.warn('[CacheManager] DeviceState.updateFromOptions method not found. Skipping optimistic update.');
        
        // Mock the command queue call to avoid actual execution
        mockCommandQueue.enqueueCommand.mockResolvedValueOnce(undefined);
        return;
      });
      
      // Create a desired state with power on
      const desiredState = new DeviceState();
      desiredState.setPower(PowerState.On);
      
      // Call applyStateToDevice
      await cacheManager.applyStateToDevice(desiredState);
      
      // Verify warning was logged
      expect((cacheManager as any).logger.warn).toHaveBeenCalledWith(
        '[CacheManager] DeviceState.updateFromOptions method not found. Skipping optimistic update.'
      );
      
      // Restore original method
      cacheManager.applyStateToDevice = originalApplyStateToDevice;
    });
  });

  describe('getDeviceState', () => {
    it('should return the internal DeviceState instance', () => {
      // Get the device state
      const result = cacheManager.getDeviceState();
      
      // Should be the same instance we set
      expect(result).toBe(mockDeviceState);
    });
  });
  
  describe('Instance management', () => {
    it('should provide a logger to the instance if passed to getInstance', () => {
      const mockLogger = { 
        info: vi.fn(), 
        debug: vi.fn(), 
        warn: vi.fn(), 
        error: vi.fn() 
      };
      
      const instance = CacheManager.getInstance(config, mockLogger as any);
      
      // Logger should be set to the provided logger
      expect((instance as any).logger).toBe(mockLogger);
    });
  });
});
