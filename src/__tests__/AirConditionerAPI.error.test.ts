import { vi, describe, beforeEach, it, expect, afterEach } from 'vitest';
import { PowerState, FanSpeed, SleepModeState } from '../enums.js';

// Mock dgram before imports to avoid hoisting issues
vi.mock('dgram', () => {
  const createSocket = vi.fn();
  return {
    createSocket,
  };
});

// Import after mocks
import * as dgram from 'dgram';
import { AirConditionerAPI } from '../AirConditionerAPI.js';

// Types for mocking
type MessageCallback = (msg: Buffer) => void;
type ErrorCallback = (err: Error) => void;
type SendCallback = (error?: Error | null) => void;

describe('AirConditionerAPI - Error Handling', () => {
  let api: AirConditionerAPI;
  let mockSocket: any;
  
  // Set a very short timeout for all tests in this suite
  vi.setConfig({ testTimeout: 500 });
  
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Create a fresh mockSocket instance
    mockSocket = {
      on: vi.fn(),
      send: vi.fn((msg: Buffer | string, port: number, ip: string, cb: SendCallback) => cb(null)),
      removeAllListeners: vi.fn(),
      close: vi.fn(),
      unref: vi.fn(),
    };
    
    // Mock dgram.createSocket to return our mockSocket
    (dgram.createSocket as ReturnType<typeof vi.fn>).mockReturnValue(mockSocket);
    
    // Create API instance with short timeouts for testing
    api = new AirConditionerAPI('192.168.1.100', 7777, 1, 5);
    
    // Add a spy on emit
    vi.spyOn(api, 'emit');
  });
  
  afterEach(() => {
    if (api) {
      api.cleanup();
    }
  });
  
  it('should handle null lastStatus when setting beep state', async () => {
    // Ensure lastStatus is null
    (api as any).lastStatus = null;
    
    // Mock sendCommandWithRetry to immediately succeed without waiting
    vi.spyOn(api as any, 'sendCommandWithRetry').mockResolvedValue('<msg><SetResponse>success</SetResponse></msg>');
    
    // Call method
    await api.setBeepState(PowerState.On);
    
    // Verify command was sent by checking if sendCommandWithRetry was called
    expect((api as any).sendCommandWithRetry).toHaveBeenCalled();
    
    // No status events should be emitted since lastStatus is null
    expect(api.emit).not.toHaveBeenCalledWith('status', expect.anything());
  });
  
  it('should handle network errors when sending commands', async () => {
    // Mock sendCommandWithRetry to reject
    const networkError = new Error('Network error');
    vi.spyOn(api as any, 'sendCommandWithRetry').mockRejectedValue(networkError);
    
    // Call method and expect error
    let thrownError: Error | undefined;
    try {
      await api.setBeepState(PowerState.On);
    } catch (err) {
      thrownError = err as Error;
    }
    
    // Verify error was thrown
    expect(thrownError).toBeDefined();
    expect(thrownError?.message).toBe('Network error');
  });
  
  it('should handle timeout errors when commands receive no response', async () => {
    // Mock sendCommandWithRetry to reject with timeout error
    vi.spyOn(api as any, 'sendCommandWithRetry').mockRejectedValue(new Error('Command timed out'));
    
    // Call and expect timeout error
    let thrownError: Error | undefined;
    try {
      await api.setBeepState(PowerState.On);
    } catch (err) {
      thrownError = err as Error;
    }
    
    // Verify timeout error was thrown
    expect(thrownError).toBeDefined();
    expect(thrownError?.message).toBe('Command timed out');
  });
  
  it('should handle null lastStatus for all combined command methods', async () => {
    // Ensure lastStatus is null
    (api as any).lastStatus = null;
    
    // Mock sendCommandWithRetry to succeed
    vi.spyOn(api as any, 'sendCommandWithRetry').mockResolvedValue('<msg><SetResponse>success</SetResponse></msg>');
    
    // Test each combined command method
    await api.setFanAndSleepState(FanSpeed.Low, SleepModeState.On);
    await api.setTurboAndSleep(FanSpeed.Low, SleepModeState.On);
    await api.setSleepAndTurbo(FanSpeed.High, SleepModeState.Off);
    
    // No status events should be emitted for any of them
    expect(api.emit).not.toHaveBeenCalledWith('status', expect.anything());
  });
});
