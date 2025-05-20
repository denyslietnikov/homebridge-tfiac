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

// Mock setup for UDP socket
const mockSocket = {
  on: vi.fn(),
  once: vi.fn(),
  send: vi.fn(),
  close: vi.fn(),
  bind: vi.fn(),
  setBroadcast: vi.fn(),
  addMembership: vi.fn(),
  removeAllListeners: vi.fn(),
  unref: vi.fn(),
};

describe('AirConditionerAPI - Extended Tests', () => {
  let api: AirConditionerAPI;
  let messageCallback: MessageCallback;
  let errorCallback: ErrorCallback;
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();

    // Set up mock for dgram socket creation
    (dgram.createSocket as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockSocket);

    // Create binding for message handler
    mockSocket.on.mockImplementation((event: string, callback: MessageCallback | ErrorCallback) => {
      if (event === 'message') {
        messageCallback = callback as MessageCallback;
      } else if (event === 'error') {
        errorCallback = callback as ErrorCallback;
      }
      return mockSocket;
    });

    // Mock socket.send to simulate response
    mockSocket.send.mockImplementation(
      (
        _msg: Buffer,
        _port: number,
        _address: string,
        callback: SendCallback,
      ) => {
        if (callback) {
          process.nextTick(() => callback(null));
        }
        return mockSocket;
      },
    );

    // Initialize API
    api = new AirConditionerAPI(
      '192.168.1.100', // ip
      8080, // port
      // TODO: Consider if maxRetries and retryDelay should be configurable for tests or use defaults
    );
    // Attach the mock logger to the API instance if your API supports a setLogger method or similar
    // For example: (api as any).logger = mockLogger; 
    // Or if events are used for logging:
    api.on('debug', mockLogger.debug);
    api.on('error', mockLogger.error); // Assuming 'error' events are emitted for errors
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  // Tests specifically focused on updateState with different throttling scenarios
  describe('updateState throttling', () => {
    beforeEach(() => {
      vi.useFakeTimers(); // Ensure timers are faked for this describe block
    });

    it('should throttle requests when called in quick succession', async () => {
      // Set up first response
      const firstResponse = `<msg msgid="statusUpdateMsg" type="Control" seq="1"><statusUpdateMsg><BaseMode>cool</BaseMode><TurnOn>on</TurnOn><Opt_display>on</Opt_display><Opt_ECO>off</Opt_ECO><Opt_super>off</Opt_super><SetTemp>23</SetTemp><WindSpeed>Auto</WindSpeed><WindDirection_H>off</WindDirection_H><WindDirection_V>off</WindDirection_V><IndoorTemp>25</IndoorTemp><Opt_sleepMode>off</Opt_sleepMode></statusUpdateMsg></msg>`;
      
      mockSocket.send.mockImplementationOnce(
        (
          _msg: Buffer,
          _port: number,
          _address: string,
          callback: SendCallback,
        ) => {
          if (callback) process.nextTick(() => callback(null));
          setTimeout(() => {
            if (messageCallback) {
              messageCallback(Buffer.from(firstResponse));
            }
          }, 50);
          return mockSocket;
        },
      );

      // Make first call
      const firstPromise = api.updateState();
      vi.runOnlyPendingTimers();
      const firstStatus = await firstPromise;
      expect(firstStatus.is_on).toBe(PowerState.On);
      expect(firstStatus.operation_mode).toBe(OperationMode.Cool);
      
      // Advance time but not enough for throttle
      vi.advanceTimersByTime(500); // Less than throttle period
      
      // Make second call which should return cached result
      const secondStatus = await api.updateState(); // This should not involve mockSocket.send or new timers for response
      
      // Should return cached result without sending new command
      expect(mockSocket.send).toHaveBeenCalledTimes(1);
      expect(secondStatus).toBe(firstStatus); // Same object reference
      
      // Force update should ignore throttling
      const forceResponse = `<msg msgid="statusUpdateMsg" type="Control" seq="2"><statusUpdateMsg><BaseMode>heat</BaseMode><TurnOn>on</TurnOn><Opt_display>on</Opt_display><Opt_ECO>off</Opt_ECO><Opt_super>on</Opt_super><SetTemp>25</SetTemp><WindSpeed>High</WindSpeed><WindDirection_H>on</WindDirection_H><WindDirection_V>on</WindDirection_V><IndoorTemp>22</IndoorTemp><Opt_sleepMode>off</Opt_sleepMode></statusUpdateMsg></msg>`;
      mockSocket.send.mockImplementationOnce(
        (
          _msg: Buffer,
          _port: number,
          _address: string,
          callback: SendCallback,
        ) => {
          if (callback) process.nextTick(() => callback(null));
          setTimeout(() => {
            if (messageCallback) {
              messageCallback(Buffer.from(forceResponse));
            }
          }, 50);
          return mockSocket;
        },
      );
      
      const forcedPromise = api.updateState(true);
      vi.runOnlyPendingTimers();
      const forcedStatus = await forcedPromise;
      expect(mockSocket.send).toHaveBeenCalledTimes(2);
      expect(forcedStatus.operation_mode).toBe(OperationMode.Heat);
    });
  });

  // Test parsing of numeric fan speeds in responses
  describe('fan speed parsing', () => {
    beforeEach(() => {
      vi.useFakeTimers(); // Ensure timers are faked for this describe block
    });

    it('should handle numeric fan speed values correctly', async () => {
      // Setup response with numeric fan speed
      const responseWithNumericFan = `<msg msgid="statusUpdateMsg" type="Control" seq="1"><statusUpdateMsg><BaseMode>cool</BaseMode><TurnOn>on</TurnOn><Opt_display>on</Opt_display><Opt_ECO>off</Opt_ECO><Opt_super>off</Opt_super><SetTemp>23</SetTemp><WindSpeed>50</WindSpeed><WindDirection_H>off</WindDirection_H><WindDirection_V>off</WindDirection_V><IndoorTemp>25</IndoorTemp></statusUpdateMsg></msg>`;
      
      mockSocket.send.mockImplementationOnce(
        (
          _msg: Buffer,
          _port: number,
          _address: string,
          callback: SendCallback,
        ) => {
          if (callback) process.nextTick(() => callback(null));
          setTimeout(() => {
            if (messageCallback) {
              messageCallback(Buffer.from(responseWithNumericFan));
            }
          }, 50);
          return mockSocket;
        },
      );

      const promise = api.updateState();
      vi.runOnlyPendingTimers();
      const status = await promise;
      expect(status.fan_mode).toBe(FanSpeed.MediumLow);
    });
  });

  // Test handling outdoor temperature in responses
  describe('outdoor temperature parsing', () => {
    beforeEach(() => {
      vi.useFakeTimers(); // Ensure timers are faked for this describe block
    });

    it('should parse outdoor temperature when available', async () => {
      const responseWithOutdoorTemp = `<msg msgid="statusUpdateMsg" type="Control" seq="1"><statusUpdateMsg><BaseMode>cool</BaseMode><TurnOn>on</TurnOn><SetTemp>23</SetTemp><WindSpeed>Auto</WindSpeed><IndoorTemp>25</IndoorTemp><OutdoorTemp>30</OutdoorTemp></statusUpdateMsg></msg>`;
      mockSocket.send.mockImplementationOnce(
        (
          _msg: Buffer,
          _port: number,
          _address: string,
          callback: SendCallback,
        ) => {
          if (callback) process.nextTick(() => callback(null));
          setTimeout(() => {
            if (messageCallback) {
              messageCallback(Buffer.from(responseWithOutdoorTemp));
            }
          }, 50);
          return mockSocket;
        },
      );
      const promise = api.updateState();
      vi.runOnlyPendingTimers();
      const status = await promise;
      expect(status.outdoor_temp).toBe(30);
    });

    it('should handle undefined outdoor temperature', async () => {
      const responseWithoutOutdoorTemp = `<msg msgid="statusUpdateMsg" type="Control" seq="1"><statusUpdateMsg><BaseMode>cool</BaseMode><TurnOn>on</TurnOn><SetTemp>23</SetTemp><WindSpeed>Auto</WindSpeed><IndoorTemp>25</IndoorTemp></statusUpdateMsg></msg>`;
      mockSocket.send.mockImplementationOnce(
        (
          _msg: Buffer,
          _port: number,
          _address: string,
          callback: SendCallback,
        ) => {
          if (callback) process.nextTick(() => callback(null));
          setTimeout(() => {
            if (messageCallback) {
              messageCallback(Buffer.from(responseWithoutOutdoorTemp));
            }
          }, 50);
          return mockSocket;
        },
      );
      const promise = api.updateState();
      vi.runOnlyPendingTimers();
      const status = await promise;
      expect(status.outdoor_temp).toBeUndefined();
    });
  });

  // Test turbo mode auto-detection
  describe('turbo mode detection', () => {
    beforeEach(() => {
      vi.useFakeTimers(); // Ensure timers are faked for this describe block
    });

    it('should auto-detect turbo mode when fan speed is Turbo', async () => {
      const responseWithTurboFan = `<msg msgid="statusUpdateMsg" type="Control" seq="1"><statusUpdateMsg><BaseMode>cool</BaseMode><TurnOn>on</TurnOn><SetTemp>23</SetTemp><WindSpeed>Turbo</WindSpeed><IndoorTemp>25</IndoorTemp></statusUpdateMsg></msg>`;
      mockSocket.send.mockImplementationOnce(
        (
          _msg: Buffer,
          _port: number,
          _address: string,
          callback: SendCallback,
        ) => {
          if (callback) process.nextTick(() => callback(null));
          setTimeout(() => {
            if (messageCallback) {
              messageCallback(Buffer.from(responseWithTurboFan));
            }
          }, 50);
          return mockSocket;
        },
      );
      const promise = api.updateState();
      vi.runOnlyPendingTimers();
      const status = await promise;
      expect(status.opt_turbo).toBe(PowerState.On);
      expect(status.fan_mode).toBe(FanSpeed.Turbo);
    });
  });

  // Test error handling in updateState
  describe('error handling in updateState', () => {
    beforeEach(() => {
      vi.useFakeTimers(); // Ensure timers are faked for this describe block
    });

    it('should throw error when response parsing fails', async () => {
      // Setup invalid XML response
      const invalidResponse = `<msg msgid="statusUpdateMsg" type="Control" seq="1\"><statusUpdateMsg><BaseMode>cool</BaseMode><TurnOn>on</TurnOn><InvalidXMLStructure></statusUpdateMsg></msg>`;
      
      mockSocket.send.mockImplementationOnce(
        (
          _msg: Buffer,
          _port: number,
          _address: string,
          callback: SendCallback,
        ) => {
          if (callback) process.nextTick(() => callback(null));
          setTimeout(() => {
            if (messageCallback) {
              messageCallback(Buffer.from(invalidResponse));
            }
          }, 50);
          return mockSocket;
        },
      );

      const promise = api.updateState();
      vi.runOnlyPendingTimers();
      await expect(promise).rejects.toThrowError(/Unexpected close tag/);
    });
  });

  // Test swing mode mapping
  describe('swing mode mapping', () => {
    beforeEach(() => {
      vi.useFakeTimers(); // Ensure timers are faked for this describe block
    });

    it('should correctly map horizontal swing mode', async () => {
      const responseHorizontalSwing = `<msg msgid="statusUpdateMsg" type="Control" seq="1"><statusUpdateMsg><BaseMode>cool</BaseMode><TurnOn>on</TurnOn><SetTemp>23</SetTemp><WindSpeed>Auto</WindSpeed><IndoorTemp>25</IndoorTemp><WindDirection_H>on</WindDirection_H><WindDirection_V>off</WindDirection_V></statusUpdateMsg></msg>`;
      mockSocket.send.mockImplementationOnce(
        (
          _msg: Buffer,
          _port: number,
          _address: string,
          callback: SendCallback,
        ) => {
          if (callback) process.nextTick(() => callback(null));
          setTimeout(() => {
            if (messageCallback) {
              messageCallback(Buffer.from(responseHorizontalSwing));
            }
          }, 50);
          return mockSocket;
        },
      );
      const promise = api.updateState();
      vi.runOnlyPendingTimers();
      const status = await promise;
      expect(status.swing_mode).toBe(SwingMode.Horizontal);
    });

    it('should correctly map vertical swing mode', async () => {
      const responseVerticalSwing = `<msg msgid="statusUpdateMsg" type="Control" seq="1"><statusUpdateMsg><BaseMode>cool</BaseMode><TurnOn>on</TurnOn><SetTemp>23</SetTemp><WindSpeed>Auto</WindSpeed><IndoorTemp>25</IndoorTemp><WindDirection_H>off</WindDirection_H><WindDirection_V>on</WindDirection_V></statusUpdateMsg></msg>`;
      mockSocket.send.mockImplementationOnce(
        (
          _msg: Buffer,
          _port: number,
          _address: string,
          callback: SendCallback,
        ) => {
          if (callback) process.nextTick(() => callback(null));
          setTimeout(() => {
            if (messageCallback) {
              messageCallback(Buffer.from(responseVerticalSwing));
            }
          }, 50);
          return mockSocket;
        },
      );
      const promise = api.updateState();
      vi.runOnlyPendingTimers();
      const status = await promise;
      expect(status.swing_mode).toBe(SwingMode.Vertical);
    });

    it('should correctly map both swing modes', async () => {
      const responseBothSwing = `<msg msgid="statusUpdateMsg" type="Control" seq="1"><statusUpdateMsg><BaseMode>cool</BaseMode><TurnOn>on</TurnOn><SetTemp>23</SetTemp><WindSpeed>Auto</WindSpeed><IndoorTemp>25</IndoorTemp><WindDirection_H>on</WindDirection_H><WindDirection_V>on</WindDirection_V></statusUpdateMsg></msg>`;
      mockSocket.send.mockImplementationOnce(
        (
          _msg: Buffer,
          _port: number,
          _address: string,
          callback: SendCallback,
        ) => {
          if (callback) process.nextTick(() => callback(null));
          setTimeout(() => {
            if (messageCallback) {
              messageCallback(Buffer.from(responseBothSwing));
            }
          }, 50);
          return mockSocket;
        },
      );
      const promise = api.updateState();
      vi.runOnlyPendingTimers();
      const status = await promise;
      expect(status.swing_mode).toBe(SwingMode.Both);
    });
  });
});
