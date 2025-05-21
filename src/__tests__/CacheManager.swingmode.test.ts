import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import CacheManager from '../CacheManager.js';
import { TfiacDeviceConfig } from '../settings.js';
import { PowerState, SwingMode } from '../enums.js';
import { DeviceState } from '../state/DeviceState.js';

describe('CacheManager', () => {
  describe('SwingMode Tests', () => {
    let cacheManager: CacheManager;
    let config: TfiacDeviceConfig;
    let mockApi: any;
    let mockDeviceState: DeviceState;
    let mockCommandQueue: any;

    // Save the original NODE_ENV
    const originalNodeEnv = process.env.NODE_ENV;
    
    beforeEach(() => {
      // Reset mocks
      vi.clearAllMocks();
      
      // Set NODE_ENV to test
      process.env.NODE_ENV = 'test';
      
      // Create a basic config
      config = {
        name: 'Test AC',
        ip: '192.168.1.100',
        port: 8080,
        updateInterval: 15, // 15 seconds
      } as TfiacDeviceConfig;
      
      // Create a new instance
      cacheManager = CacheManager.getInstance(config);
      
      // Create a mock logger
      const mockLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };
      (cacheManager as any).logger = mockLogger;
      
      // Override internal API with mock
      mockApi = {
        updateState: vi.fn().mockResolvedValue({ is_on: 'on', current_temp: 25 }),
        emit: vi.fn(),
        on: vi.fn(),
        removeAllListeners: vi.fn(),
        cleanup: vi.fn(),
      };
      (cacheManager as any).api = mockApi;
      
      // Create a mock for CommandQueue with enqueueCommand method
      mockCommandQueue = {
        enqueueCommand: vi.fn().mockResolvedValue(undefined),
        removeAllListeners: vi.fn(),
        on: vi.fn(),
      };
      
      // Mock the getCommandQueue method to return our mockCommandQueue
      cacheManager.getCommandQueue = vi.fn().mockReturnValue(mockCommandQueue);
      
      // Create a mock for deviceState
      mockDeviceState = {
        power: PowerState.On,
        swingMode: SwingMode.Off,
        setSwingMode: vi.fn(),
        updateFromOptions: vi.fn(),
        clone: vi.fn().mockImplementation(() => {
          return mockDeviceState;
        }),
        toPlainObject: vi.fn().mockReturnValue({}),
        removeAllListeners: vi.fn(),
      } as unknown as DeviceState;
      
      // Set the mock deviceState to the cacheManager
      (cacheManager as any)._deviceState = mockDeviceState;
    });
    
    afterEach(() => {
      // Restore NODE_ENV
      process.env.NODE_ENV = originalNodeEnv;
    });
    
    describe('applyStateToDevice', () => {
      it('should detect changes when swingMode differs from Off to Vertical', async () => {
        // Arrange: Set up our desired state with Vertical swing
        const desiredState = {
          ...mockDeviceState,
          power: PowerState.On,
          swingMode: SwingMode.Vertical, // This is different from mockDeviceState (Off)
        } as DeviceState;
        
        // Act: Call the method
        await cacheManager.applyStateToDevice(desiredState);
        
        // Assert: Check if the command was enqueued with the right options
        expect(mockCommandQueue.enqueueCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            swingMode: SwingMode.Vertical
          })
        );
        
        // Check that the logger reported changes
        expect((cacheManager as any).logger.info).toHaveBeenCalledWith(
          expect.stringContaining('Changes detected')
        );
      });
      
      it('should detect changes when swingMode differs from Vertical to Horizontal', async () => {
        // Create desiredState with its own swingMode property
        const currentState = { ...mockDeviceState, swingMode: SwingMode.Vertical };
        // Override clone to return our currentState instead
        mockDeviceState.clone = vi.fn().mockReturnValue(currentState);
        (cacheManager as any)._deviceState = currentState;
        
        // Set up desired state with Horizontal swing
        const desiredState = {
          ...currentState,
          swingMode: SwingMode.Horizontal,
        } as DeviceState;
        
        // Act: Call the method
        await cacheManager.applyStateToDevice(desiredState);
        
        // Assert: Check if the command was enqueued with the right options
        expect(mockCommandQueue.enqueueCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            swingMode: SwingMode.Horizontal
          })
        );
        
        // Check that the logger reported changes
        expect((cacheManager as any).logger.info).toHaveBeenCalledWith(
          expect.stringContaining('Changes detected')
        );
      });
      
      it('should detect changes when swingMode differs from Horizontal to Both', async () => {
        // Arrange: Set up mockDeviceState with Horizontal swing
        (mockDeviceState as any).swingMode = SwingMode.Horizontal;

        // Set up desired state with Both swing
        const desiredState = {
          ...mockDeviceState,
          swingMode: SwingMode.Both,
        } as DeviceState;
        
        // Act: Call the method
        await cacheManager.applyStateToDevice(desiredState);
        
        // Assert: Check if the command was enqueued with the right options
        expect(mockCommandQueue.enqueueCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            swingMode: SwingMode.Both
          })
        );
        
        // Check that the logger reported changes
        expect((cacheManager as any).logger.info).toHaveBeenCalledWith(
          expect.stringContaining('Changes detected')
        );
      });
      
      it('should detect changes when swingMode differs from Both to Off', async () => {
        // Arrange: Set up current state with Both swing
        const currentTestState = { 
          ...mockDeviceState, // Spread properties and methods from the base mock
          swingMode: SwingMode.Both // Override swingMode for this test's current state
        };
        // Ensure that when cacheManager's _deviceState.clone() is called, it returns this currentTestState
        mockDeviceState.clone = vi.fn().mockReturnValue(currentTestState);
        (cacheManager as any)._deviceState = currentTestState as DeviceState; // Set cacheManager's internal state
        
        // Set up desired state with Off swing
        const desiredState = {
          ...mockDeviceState, // Base desired state on the original mock from beforeEach for other properties
          swingMode: SwingMode.Off, // Set the desired swingMode for this test
        } as DeviceState;
        
        // Act: Call the method
        await cacheManager.applyStateToDevice(desiredState);
        
        // Assert: Check if the command was enqueued with the right options
        expect(mockCommandQueue.enqueueCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            swingMode: SwingMode.Off
          })
        );
        
        // Check that the logger reported changes
        expect((cacheManager as any).logger.info).toHaveBeenCalledWith(
          expect.stringContaining('Changes detected')
        );
      });
      
      it('should detect changes when swingMode is set to same value as current (equality bug check)', async () => {
        // This test specifically looks for string equality bugs when values appear the same but aren't
        
        // Arrange: Set up mockDeviceState with Off swing as a string (not enum)
        (mockDeviceState as any).swingMode = 'Off' as SwingMode; // Deliberately using string instead of enum
        
        // Set up desired state with Off swing as enum
        const desiredState = {
          ...mockDeviceState,
          swingMode: SwingMode.Off, // Using enum value
        } as DeviceState;
        
        // Act: Call the method
        await cacheManager.applyStateToDevice(desiredState);
        
        // Assert: Since these are technically different (string vs enum), command should be enqueued
        // But if string comparison is working correctly, it will recognize they're the same and NOT enqueue
        expect(mockCommandQueue.enqueueCommand).not.toHaveBeenCalled();
        
        // Check that the logger reported no changes
        expect((cacheManager as any).logger.info).toHaveBeenCalledWith(
          expect.stringContaining('No changes to apply')
        );
      });
      
      it('should not enqueue command when current and desired swingMode are the same', async () => {
        // Arrange: Set up mockDeviceState with Vertical swing
        (mockDeviceState as any).swingMode = SwingMode.Vertical;
        
        // Set up desired state with the same Vertical swing
        const desiredState = {
          ...mockDeviceState,
          swingMode: SwingMode.Vertical,
        } as DeviceState;
        
        // Act: Call the method
        await cacheManager.applyStateToDevice(desiredState);
        
        // Assert: Check that no command was enqueued (no changes)
        expect(mockCommandQueue.enqueueCommand).not.toHaveBeenCalled();
        
        // Check that the logger reported no changes
        expect((cacheManager as any).logger.info).toHaveBeenCalledWith(
          expect.stringContaining('No changes to apply')
        );
      });
      
      it('should optimistically update local state when swing mode changes', async () => {
        // Arrange: Set up mockDeviceState with Off swing
        (mockDeviceState as any).swingMode = SwingMode.Off;
        
        // Set up desired state with Vertical swing
        const desiredState = {
          ...mockDeviceState,
          swingMode: SwingMode.Vertical,
        } as DeviceState;
        
        // Act: Call the method
        await cacheManager.applyStateToDevice(desiredState);
        
        // Assert: Check that updateFromOptions was called with the right options
        expect(mockDeviceState.updateFromOptions).toHaveBeenCalledWith(
          expect.objectContaining({
            swingMode: SwingMode.Vertical
          })
        );
      });
    });
  });
});
