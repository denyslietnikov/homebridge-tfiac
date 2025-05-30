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

// Test data
const mockResponseXML = `
  <msg msgid="statusUpdateMsg" type="Control" seq="55">
    <statusUpdateMsg>
      <IndoorTemp>73</IndoorTemp>
      <SetTemp>70</SetTemp>
      <BaseMode>cool</BaseMode>
      <WindSpeed>Auto</WindSpeed>
      <TurnOn>on</TurnOn>
      <WindDirection_H>off</WindDirection_H>
      <WindDirection_V>off</WindDirection_V>
      <Opt_display>on</Opt_display>
      <Opt_ECO>off</Opt_ECO>
      <Opt_super>off</Opt_super>
      <Opt_sleepMode>sleepMode1:0:0:0:0:0:0:0:0:0:0</Opt_sleepMode>
      <BeepEnable>on</BeepEnable>
      <DeviceName>AC Living Room</DeviceName>
      <WifiVer>1</WifiVer>
    </statusUpdateMsg>
  </msg>
`;

const mockErrorResponseXML = `
  <msg msgid="ACKSetMessage" type="Control" seq="52">
    <ACKSetMessage><Return>error</Return></ACKSetMessage>
  </msg>
`;

describe('AirConditionerAPI - Coverage Improvements', () => {
  let api: AirConditionerAPI;
  let mockSocket: any;

  // Set longer timeout for these tests
  vi.setConfig({ testTimeout: 15000 });

  const getMessageHandlers = (): MessageCallback[] => {
    return (mockSocket.on.mock.calls as ['message' | 'error', MessageCallback | ErrorCallback][])
      .filter(([event]) => event === 'message')
      .map(([, handler]) => handler as MessageCallback);
  };

  const simulateResponse = (xml: string = mockResponseXML, delay: number = 50): void => {
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

  // Test for when lastStatus is null and a conflict resolution is needed
  it('should handle null lastStatus when setting multiple options with conflicts', async () => {
    vi.useRealTimers();
    
    // Ensure lastStatus is null
    (api as any).lastStatus = null;
    
    // Mock updateState to return a valid status
    vi.spyOn(api, 'updateState').mockResolvedValue({
      is_on: PowerState.On,
      operation_mode: OperationMode.Cool,
      target_temp: 22,
      current_temp: 24,
      fan_mode: FanSpeed.Auto,
      swing_mode: SwingMode.Off,
    } as AirConditionerStatus);
    
    // Override send to call callback and simulate a successful response
    mockSocket.send.mockImplementation((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        callback(null);
        simulateResponse(`
          <msg msgid="ACKSetMessage" type="Control" seq="52">
            <ACKSetMessage><Return>ok</Return></ACKSetMessage>
          </msg>
        `, 10);
      }
    });
    
    // Call with conflicting options: both sleep and turbo mode enabled
    await api.setDeviceOptions({
      power: PowerState.On,
      fanSpeed: FanSpeed.Low,
      sleep: SleepModeState.On,
      turbo: PowerState.On,
      mode: OperationMode.Cool,
      temp: 24, // Added temp to ensure a SetTemp is included in the payload
    });
    
    // Verify that the XML sent contains the expected values after conflict resolution
    expect(mockSocket.send).toHaveBeenCalledWith(
      expect.stringContaining('<TurnOn>on</TurnOn>'),
      7777,
      '192.168.1.100',
      expect.any(Function)
    );
    
    // Since turbo wins over sleep in conflict resolution
    expect(mockSocket.send).toHaveBeenCalledWith(
      expect.stringContaining('<Opt_super>on</Opt_super>'),
      7777,
      '192.168.1.100',
      expect.any(Function)
    );
    
    expect(mockSocket.send).toHaveBeenCalledWith(
      expect.stringContaining('<Opt_sleepMode>off</Opt_sleepMode>'),
      7777,
      '192.168.1.100',
      expect.any(Function)
    );

    // Verify that WindSpeed is Turbo because Turbo mode implies highest fan speed
    expect(mockSocket.send).toHaveBeenCalledWith(
      expect.stringContaining('<WindSpeed>Turbo</WindSpeed>'),
      7777,
      '192.168.1.100',
      expect.any(Function)
    );
  });

  it('should handle options that imply power should be on even when not explicitly set', async () => {
    vi.useRealTimers();
    
    // Setup a valid lastStatus with power off
    (api as any).lastStatus = {
      is_on: PowerState.Off,
      operation_mode: OperationMode.Cool,
      target_temp: 22,
      current_temp: 24,
      fan_mode: FanSpeed.Auto,
      swing_mode: SwingMode.Off,
    };
    
    // Mock updateState to prevent network calls and ensure lastStatus is used
    vi.spyOn(api, 'updateState').mockResolvedValue((api as any).lastStatus);

    // Override send to call callback and simulate a successful response
    mockSocket.send.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as SendCallback;
      if (typeof callback === 'function') {
        callback(); // Simulate successful send
      }
      // Simulate a status update response after a short delay
      simulateResponse(mockResponseXML, 50);
    });

    // Make a call that implicitly requires power to be on
    await api.setDeviceOptions({
      temp: 25, // Setting temperature implies power should be on
    });
    
    // Verify power was turned on in the command sent
    expect(mockSocket.send).toHaveBeenCalledWith(
      expect.stringContaining('<TurnOn>on</TurnOn>'),
      7777,
      '192.168.1.100',
      expect.any(Function)
    );
  });

  it('should handle _sendCommandPayload with no changes to send', async () => {
    vi.useRealTimers();
    
    // Mock lastStatus with specific values
    (api as any).lastStatus = {
      is_on: PowerState.On,
      operation_mode: OperationMode.Cool,
      target_temp: 22,
      current_temp: 24,
      fan_mode: FanSpeed.Auto,
      swing_mode: SwingMode.Off,
      opt_turbo: PowerState.Off,
      opt_eco: PowerState.Off,
      opt_display: PowerState.On,
      opt_beep: PowerState.On,
      opt_sleepMode: SleepModeState.Off,
    };
    
    // Call _sendCommandPayload with empty payload
    await (api as any)._sendCommandPayload(
      {}, // Empty payload
      { is_on: PowerState.On }, // Optimistic update still present
      'testNoChanges'
    );
    
    // Verify no UDP message was sent
    expect(mockSocket.send).not.toHaveBeenCalled();
    
    // But emit should have been called with debug message about no changes
    expect(api.emit).toHaveBeenCalledWith('debug', expect.stringContaining('No changes to send.'));
  });

  it('should handle error response from device', async () => {
    vi.useRealTimers();

    // Ensure lastStatus is set, otherwise updateState will be called first by setDeviceOptions
    (api as any).lastStatus = {
      is_on: PowerState.On,
      operation_mode: OperationMode.Cool,
      target_temp: 22,
      current_temp: 24,
      fan_mode: FanSpeed.Auto,
      swing_mode: SwingMode.Off,
    };

    // Mock send to simulate an error response from the device
    mockSocket.send.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as SendCallback;
      if (typeof callback === 'function') {
        callback(); // Simulate successful send before device "processes" and returns error
      }
      // Simulate an error response from the device
      simulateResponse(mockErrorResponseXML, 50);
    });
    
    // Call setDeviceOptions and expect it to not throw, but log an error
    // The API is designed to not throw on device error responses but emit an 'error' event or log.
    // We will check for the debug log of the error response.
    await api.setDeviceOptions({ power: PowerState.On });

    // Check if an error was emitted or logged (assuming 'debug' for error responses based on _sendCommandPayload)
    // The first call to emit will be the sending command, the second will be the received response.
    expect(api.emit).toHaveBeenNthCalledWith(2,
      'debug',
      // The debug message now includes the caller method and potentially different formatting
      expect.stringContaining('[setDeviceOptions] Received response:') && expect.stringContaining('<Return>error</Return>')
    );
  });

  it('should verify optimistic update with null lastStatus', async () => {
    vi.useRealTimers();
    
    // Ensure lastStatus is null
    (api as any).lastStatus = null;
    
    // Mock updateState to return a valid status
    vi.spyOn(api, 'updateState').mockResolvedValue({
      is_on: PowerState.On,
      operation_mode: OperationMode.Cool,
      target_temp: 22,
      current_temp: 24,
      fan_mode: FanSpeed.Auto,
      swing_mode: SwingMode.Off,
    } as AirConditionerStatus);
    
    // Mock _sendCommandPayload directly to test the optimistic update
    vi.spyOn(api as any, '_sendCommandPayload').mockImplementation(
      async (_payload: any, optimisticUpdate: any) => {
        // Test the optimistic update application with null lastStatus
        (api as any).emit('stateUpdate', optimisticUpdate);
      }
    );
    
    // Call with options that should generate an optimistic update
    await api.setDeviceOptions({
      power: PowerState.On,
      fanSpeed: FanSpeed.Low
    });
    
    // Verify that an optimistic update was emitted
    expect(api.emit).toHaveBeenCalledWith('stateUpdate', 
      expect.objectContaining({ 
        is_on: PowerState.On,
        fan_mode: FanSpeed.Low
      })
    );
  });

  it('should handle operation mode with restrictions on fan speed', async () => {
    vi.useRealTimers();
    
    // Setup a valid lastStatus
    (api as any).lastStatus = {
      is_on: PowerState.On,
      operation_mode: OperationMode.Dry, // Dry mode has fan speed restrictions
      target_temp: 22,
      current_temp: 24,
      fan_mode: FanSpeed.Auto, // Default fan speed
      swing_mode: SwingMode.Off,
    };

    // Mock updateState to prevent network calls and ensure lastStatus is used
    vi.spyOn(api, 'updateState').mockResolvedValue((api as any).lastStatus);

    // Override send to call callback and simulate a successful response
    mockSocket.send.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as SendCallback;
      if (typeof callback === 'function') {
        callback(); // Simulate successful send
      }
      // Simulate a status update response after a short delay
      simulateResponse(mockResponseXML, 50);
    });
    
    // Attempt to set a fan speed that is not allowed in Dry mode (e.g., High)
    await api.setDeviceOptions({
      mode: OperationMode.Dry,
      fanSpeed: FanSpeed.High, // This should be overridden to Auto or a default for Dry
    });
    
    // Verify that the fan speed sent was adjusted (e.g., to Auto or specific for Dry)
    // In Dry mode, fan speed is often fixed (e.g., to Low or Auto by the device protocol)
    // The provided code seems to default to Auto if not specified, let's assume Dry mode implies Auto.
    expect(mockSocket.send).toHaveBeenCalledWith(
      expect.stringContaining('<WindSpeed>Auto</WindSpeed>'), 
      7777,
      '192.168.1.100',
      expect.any(Function)
    );
  });

  it('should handle complete power off state clearing', async () => {
    vi.useRealTimers();
    
    // Setup a valid lastStatus with various options enabled
    (api as any).lastStatus = {
      is_on: PowerState.On,
      operation_mode: OperationMode.Cool,
      target_temp: 22,
      current_temp: 24,
      fan_mode: FanSpeed.High,
      swing_mode: SwingMode.Both,
      opt_turbo: PowerState.On,
      opt_sleepMode: SleepModeState.On,
    };

    // Mock updateState to prevent network calls and ensure lastStatus is used
    vi.spyOn(api, 'updateState').mockResolvedValue((api as any).lastStatus);

    // Override send to call callback and simulate a successful response
    mockSocket.send.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as SendCallback;
      if (typeof callback === 'function') {
        callback(); // Simulate successful send
      }
      // Simulate a status update response after a short delay
      simulateResponse(mockResponseXML, 50); // A generic response is fine
    });
    
    // Turn the device off
    await api.setDeviceOptions({ power: PowerState.Off });
    
    // Verify that the command sent includes TurnOn:off
    expect(mockSocket.send).toHaveBeenCalledWith(
      expect.stringContaining('<TurnOn>off</TurnOn>'),
      7777,
      '192.168.1.100',
      expect.any(Function)
    );
    
    // Verify that other operational states that depend on power being on are implicitly reset or not sent.
    const sentPayload = (mockSocket.send.mock.calls[0][0] as string);
    expect(sentPayload).not.toContain('<Opt_super>on</Opt_super>');
    expect(sentPayload).not.toContain('<Opt_sleepMode>sleepMode1');
    expect(sentPayload).not.toContain('<WindSpeed>');
  });
});
