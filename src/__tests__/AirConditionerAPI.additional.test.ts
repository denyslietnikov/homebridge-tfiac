import { vi, describe, beforeEach, it, expect, afterEach } from 'vitest';
import { PowerState, OperationMode, FanSpeed, SwingMode, SleepModeState } from '../enums.js';

// Mock dgram before imports to avoid hoisting issues
vi.mock('dgram', () => {
  const createSocket = vi.fn();
  return {
    createSocket,
  };
});

// Import after mocks
import * as dgram from 'dgram';
import { AirConditionerAPI, AirConditionerStatus } from '../AirConditionerAPI.js';

// Types for mocking
type MessageCallback = (msg: Buffer) => void;
type ErrorCallback = (err: Error) => void;
type SendCallback = (error?: Error | null) => void;

// Test mock responses
const mockResponseWithNumericFanSpeed = `
  <msg msgid="statusUpdateMsg" type="Control" seq="55">
    <statusUpdateMsg>
      <IndoorTemp>73</IndoorTemp>
      <SetTemp>70</SetTemp>
      <BaseMode>cool</BaseMode>
      <WindSpeed>50</WindSpeed>
      <TurnOn>on</TurnOn>
      <WindDirection_H>off</WindDirection_H>
      <WindDirection_V>off</WindDirection_V>
      <Opt_display>on</Opt_display>
      <BeepEnable>on</BeepEnable>
      <DeviceName>AC Living Room</DeviceName>
      <WifiVer>1</WifiVer>
    </statusUpdateMsg>
  </msg>
`;

const mockResponseWithTurboFanSpeed = `
  <msg msgid="statusUpdateMsg" type="Control" seq="55">
    <statusUpdateMsg>
      <IndoorTemp>73</IndoorTemp>
      <SetTemp>70</SetTemp>
      <BaseMode>cool</BaseMode>
      <WindSpeed>Turbo</WindSpeed>
      <TurnOn>on</TurnOn>
      <WindDirection_H>off</WindDirection_H>
      <WindDirection_V>off</WindDirection_V>
      <Opt_display>on</Opt_display>
      <BeepEnable>on</BeepEnable>
      <DeviceName>AC Living Room</DeviceName>
      <WifiVer>1</WifiVer>
    </statusUpdateMsg>
  </msg>
`;

const mockResponseWithOptionalFields = `
  <msg msgid="statusUpdateMsg" type="Control" seq="55">
    <statusUpdateMsg>
      <IndoorTemp>73</IndoorTemp>
      <SetTemp>70</SetTemp>
      <BaseMode>cool</BaseMode>
      <WindSpeed>Auto</WindSpeed>
      <TurnOn>on</TurnOn>
      <WindDirection_H>off</WindDirection_H>
      <WindDirection_V>off</WindDirection_V>
      <OutdoorTemp>82</OutdoorTemp>
      <BeepEnable>on</BeepEnable>
      <DeviceName>AC Living Room</DeviceName>
      <WifiVer>1</WifiVer>
    </statusUpdateMsg>
  </msg>
`;

describe('AirConditionerAPI - Additional Coverage Tests', () => {
  let api: AirConditionerAPI;
  let mockSocket: any;

  // Set longer timeout for these tests
  vi.setConfig({ testTimeout: 15000 });

  const getMessageHandlers = (): MessageCallback[] => {
    return (mockSocket.on.mock.calls as ['message' | 'error', MessageCallback | ErrorCallback][])
      .filter(([event]) => event === 'message')
      .map(([, handler]) => handler as MessageCallback);
  };

  const simulateResponse = (xml: string, delay: number = 50): void => {
    setTimeout(() => {
      getMessageHandlers().forEach((handler: MessageCallback) => handler(Buffer.from(xml)));
    }, delay);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    
    // Create a fresh mockSocket instance for each test
    mockSocket = {
      on: vi.fn(),
      bind: vi.fn(),
      setBroadcast: vi.fn(),
      send: vi.fn(),
      close: vi.fn(),
      address: vi.fn().mockReturnValue({ address: '0.0.0.0', port: 1234 }),
      removeAllListeners: vi.fn(),
      unref: vi.fn(),
    };
    
    // Mock dgram.createSocket to return our mockSocket
    (dgram.createSocket as ReturnType<typeof vi.fn>).mockReturnValue(mockSocket);

    // Basic implementation of send that calls callback immediately
    mockSocket.send.mockImplementation((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        // Immediately call callback without error
        callback(null);
      }
    });

    api = new AirConditionerAPI('192.168.1.100', 7777);
    vi.spyOn(api, 'emit');
  });

  afterEach(() => {
    if (api) {
      api.cleanup();
    }
    vi.clearAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // Test for throttling in updateState (lines 489-497)
  it('should return cached status within SHORT_WAIT when lastSeq is 0', async () => {
    vi.useRealTimers();
    
    // Set up the API with cached status
    const testStatus: AirConditionerStatus = {
      is_on: PowerState.On,
      operation_mode: OperationMode.Cool,
      target_temp: 22,
      current_temp: 24,
      fan_mode: FanSpeed.Auto,
      swing_mode: SwingMode.Off,
    };
    
    (api as any).lastStatus = testStatus;
    (api as any).lastSyncTime = Date.now();
    (api as any).lastSeq = 0; // Set to 0 to trigger the SHORT_WAIT branch
    
    // Call updateState and verify it returns the cached status
    const result = await api.updateState();
    
    // Should return cached state without sending new UDP request
    expect(result).toBe(testStatus);
    expect(mockSocket.send).not.toHaveBeenCalled();
    expect(api.emit).toHaveBeenCalledWith(
      'debug',
      expect.stringContaining('Throttling updateState: returning cached status')
    );
  });

  // Test for throttling in updateState with LONG_WAIT
  it('should return cached status within LONG_WAIT when lastSeq is not 0', async () => {
    vi.useRealTimers();
    
    // Set up the API with cached status
    const testStatus: AirConditionerStatus = {
      is_on: PowerState.On,
      operation_mode: OperationMode.Cool,
      target_temp: 22,
      current_temp: 24,
      fan_mode: FanSpeed.Auto,
      swing_mode: SwingMode.Off,
    };
    
    (api as any).lastStatus = testStatus;
    (api as any).lastSyncTime = Date.now();
    (api as any).lastSeq = 1; // Set to non-zero to trigger the LONG_WAIT branch
    
    // Call updateState and verify it returns the cached status
    const result = await api.updateState();
    
    // Should return cached state without sending new UDP request
    expect(result).toBe(testStatus);
    expect(mockSocket.send).not.toHaveBeenCalled();
    expect(api.emit).toHaveBeenCalledWith(
      'debug',
      expect.stringContaining('Throttling updateState: returning cached status')
    );
  });

  // Test for force update regardless of throttle
  it('should bypass throttling when force=true is specified', async () => {
    vi.useRealTimers();
    
    // Set up the API with cached status
    const testStatus: AirConditionerStatus = {
      is_on: PowerState.On,
      operation_mode: OperationMode.Cool,
      target_temp: 22,
      current_temp: 24,
      fan_mode: FanSpeed.Auto,
      swing_mode: SwingMode.Off,
    };
    
    (api as any).lastStatus = testStatus;
    (api as any).lastSyncTime = Date.now();
    
    // Setup response simulation
    mockSocket.send.mockImplementation((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        callback(null);
        simulateResponse(mockResponseWithOptionalFields, 10);
      }
    });
    
    // Call updateState with force=true
    await api.updateState(true);
    
    // Should send UDP request despite having cached status
    expect(mockSocket.send).toHaveBeenCalled();
    expect(api.emit).toHaveBeenCalledWith(
      'debug',
      expect.stringContaining('Sending updateState command:')
    );
  });

  // Test for numeric fan speed conversion (lines 511-514)
  it('should handle numeric fan speed values from the device', async () => {
    vi.useRealTimers();
    
    // Setup response simulation with numeric fan speed
    mockSocket.send.mockImplementation((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        callback(null);
        simulateResponse(mockResponseWithNumericFanSpeed, 10);
      }
    });
    
    // Call updateState to fetch status with numeric fan speed
    const status = await api.updateState(true);
    
    // Verify that numeric fan speed (50) was converted to proper FanSpeed enum value
    expect(status.fan_mode).toBe(FanSpeed.MediumLow); // 50 is closest to MediumLow (45)
    
    // Verify debug output
    expect(api.emit).toHaveBeenCalledWith(
      'debug',
      expect.stringContaining(`Parsed status:`)
    );
  });

  // Test for fan_mode = Turbo deriving opt_turbo state (lines 538-539)
  it('should derive opt_turbo state when fan_mode is Turbo', async () => {
    vi.useRealTimers();
    
    // Setup response simulation with Turbo fan speed
    mockSocket.send.mockImplementation((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        callback(null);
        simulateResponse(mockResponseWithTurboFanSpeed, 10);
      }
    });
    
    // Call updateState to fetch status with Turbo fan speed
    const status = await api.updateState(true);
    
    // Verify that opt_turbo was derived from fan_mode = Turbo
    expect(status.fan_mode).toBe(FanSpeed.Turbo);
    expect(status.opt_turbo).toBe(PowerState.On);
  });

  // Test for handling undefined optional fields (lines 527-532)
  it('should handle missing optional fields in the device response', async () => {
    vi.useRealTimers();
    
    // Setup response simulation with some optional fields missing
    mockSocket.send.mockImplementation((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        callback(null);
        simulateResponse(mockResponseWithOptionalFields, 10);
      }
    });
    
    // Call updateState to fetch status with missing optional fields
    const status = await api.updateState(true);
    
    // Verify that optional fields are undefined when not in the response
    expect(status.opt_display).toBeUndefined();
    expect(status.opt_turbo).toBeUndefined();
    expect(status.opt_sleepMode).toBeUndefined();
    
    // But outdoor_temp should be defined
    expect(status.outdoor_temp).toBeDefined();
    expect(status.outdoor_temp).toBe(82);
  });
});
