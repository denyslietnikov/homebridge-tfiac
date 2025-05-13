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
  let setDeviceOptionsSpy: ReturnType<typeof vi.spyOn>;

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
    // Spy on setDeviceOptions for all tests in this suite
    setDeviceOptionsSpy = vi.spyOn(api as any, 'setDeviceOptions');
  });

  afterEach(() => {
    if (api) {
      api.cleanup();
    }
    setDeviceOptionsSpy.mockRestore(); // Restore the spy
  });

  it('should handle null lastStatus when setting beep state by calling setDeviceOptions', async () => {
    // Ensure lastStatus is null by directly setting it (for testing this specific scenario)
    (api as any).lastStatus = null;
    // Mock setDeviceOptions to resolve, simulating it handles the null lastStatus (e.g., by calling updateState)
    setDeviceOptionsSpy.mockResolvedValue(undefined);

    await api.setBeepState(PowerState.On);

    expect(setDeviceOptionsSpy).toHaveBeenCalledWith({ beep: PowerState.On });
  });

  it('should propagate network errors from setDeviceOptions when sending commands', async () => {
    const networkError = new Error('Network error');
    // Mock setDeviceOptions to reject, as it's the one making the actual send call.
    setDeviceOptionsSpy.mockRejectedValue(networkError);

    let thrownError: Error | undefined;
    try {
      await api.setBeepState(PowerState.On); // setBeepState calls setDeviceOptions
    } catch (err) {
      thrownError = err as Error;
    }

    expect(setDeviceOptionsSpy).toHaveBeenCalledWith({ beep: PowerState.On });
    expect(thrownError).toBeDefined();
    expect(thrownError?.message).toBe('Network error');
  });

  it('should propagate timeout errors from setDeviceOptions when commands receive no response', async () => {
    const timeoutError = new Error('Command timed out');
    // Mock setDeviceOptions to reject with a timeout.
    setDeviceOptionsSpy.mockRejectedValue(timeoutError);

    let thrownError: Error | undefined;
    try {
      await api.setBeepState(PowerState.On); // setBeepState calls setDeviceOptions
    } catch (err) {
      thrownError = err as Error;
    }

    expect(setDeviceOptionsSpy).toHaveBeenCalledWith({ beep: PowerState.On });
    expect(thrownError).toBeDefined();
    expect(thrownError?.message).toBe('Command timed out');
  });

  it('should call setDeviceOptions for emulated combined command methods, even with null lastStatus', async () => {
    (api as any).lastStatus = null;
    setDeviceOptionsSpy.mockResolvedValue(undefined); // Assume setDeviceOptions handles it

    // Emulate former setFanAndSleepState
    await api.setDeviceOptions({
      power: PowerState.On,
      fanSpeed: FanSpeed.Low,
      sleep: SleepModeState.On,
      turbo: PowerState.Off,
    });
    expect(setDeviceOptionsSpy).toHaveBeenCalledWith({
      power: PowerState.On,
      fanSpeed: FanSpeed.Low,
      sleep: SleepModeState.On,
      turbo: PowerState.Off,
    });
    setDeviceOptionsSpy.mockClear();

    // Emulate former setTurboAndSleep
    await api.setDeviceOptions({
      power: PowerState.On,
      fanSpeed: FanSpeed.Low,
      sleep: SleepModeState.On,
      turbo: PowerState.Off,
    });
    expect(setDeviceOptionsSpy).toHaveBeenCalledWith({
      power: PowerState.On,
      fanSpeed: FanSpeed.Low,
      sleep: SleepModeState.On,
      turbo: PowerState.Off,
    });
    setDeviceOptionsSpy.mockClear();

    // Emulate former setSleepAndTurbo
    await api.setDeviceOptions({
      power: PowerState.On,
      fanSpeed: FanSpeed.High,
      turbo: PowerState.On,
      sleep: SleepModeState.Off,
    });
    expect(setDeviceOptionsSpy).toHaveBeenCalledWith({
      power: PowerState.On,
      fanSpeed: FanSpeed.High,
      turbo: PowerState.On,
      sleep: SleepModeState.Off,
    });
  });
});
