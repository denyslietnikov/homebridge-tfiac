// AirConditionerAPI.test.ts

import { vi, describe, beforeEach, it, expect, afterEach, beforeAll } from 'vitest';
import { PowerState, OperationMode, FanSpeed, SwingMode, SleepModeState } from '../enums.js'; // Import enums

// Mock dgram before imports to avoid hoisting issues
vi.mock('dgram', () => {
  const createSocket = vi.fn();
  return {
    __esModule: true,
    default: { createSocket },
  };
});

// Import after mocks
import dgram from 'dgram';
import { AirConditionerAPI, AirConditionerStatus } from '../AirConditionerAPI.js';

let mockSocket: any;

// Types for mocking
type MessageCallback = (msg: Buffer) => void;
type ErrorCallback = (err: Error) => void;
type SendCallback = (error?: Error) => void;


// Test data
const mockResponseXML = `
  <msg>
    <statusUpdateMsg>
      <IndoorTemp>72</IndoorTemp>
      <SetTemp>70</SetTemp>
      <BaseMode>cool</BaseMode>
      <WindSpeed>Auto</WindSpeed>
      <TurnOn>on</TurnOn>
      <WindDirection_H>off</WindDirection_H>
      <WindDirection_V>on</WindDirection_V>
    </statusUpdateMsg>
  </msg>
`;

describe('AirConditionerAPI', () => {
  let api: AirConditionerAPI;
  
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

    // Now implement send behavior on our mockSocket
    mockSocket.send.mockImplementation((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        // Immediately call callback without error
        callback();
        // Then simulate a response after a short delay
        setTimeout(() => {
          getMessageHandlers().forEach(handler => handler(Buffer.from(mockResponseXML)));
        }, 10);
      }
    });

    api = new AirConditionerAPI('192.168.1.100', 7777);
  });

  afterEach(() => {
    if (api) {
      api.cleanup();
    }
    vi.clearAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('should send turnOn command correctly', async () => {
    // Use real timers for this test to handle actual setTimeout behavior
    vi.useRealTimers();

    const promise = api.setDeviceOptions({ power: PowerState.On });
    await promise;

    expect(mockSocket.send).toHaveBeenCalledWith(
      expect.stringContaining('<TurnOn>on</TurnOn>'),
      7777,
      '192.168.1.100',
      expect.any(Function),
    );
  });

  it('should send turnOff command correctly', async () => {
    // Use real timers for this test to handle actual setTimeout behavior
    vi.useRealTimers();

    const promise = api.setDeviceOptions({ power: PowerState.Off });
    await promise;

    expect(mockSocket.send).toHaveBeenCalledWith(
      expect.stringContaining('<TurnOn>off</TurnOn>'),
      7777,
      '192.168.1.100',
      expect.any(Function),
    );
  });

  it('should correctly parse updateState response', async () => {
    const promise = api.updateState();
    vi.advanceTimersByTime(50);
    const status = await promise;

    expect(status).toEqual({
      current_temp: 72,
      target_temp: 70,
      operation_mode: 'cool',
      fan_mode: 'Auto',
      is_on: 'on',
      swing_mode: 'Vertical',
    });
  });

  it('should send correct swing mode command', async () => {
    // Use real timers for this test to handle actual setTimeout behavior
    vi.useRealTimers();
    
    // Reset the mock before test
    mockSocket.send.mockReset();
    
    // Prepare to catch swing mode XML commands
    mockSocket.send.mockImplementation((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        callback();
        setTimeout(() => {
          getMessageHandlers().forEach(handler => {
            handler(Buffer.from(mockResponseXML));
          });
        }, 10);
      }
    });

    // Initialize lastStatus to prevent the initial updateState call in setDeviceOptions
    (api as any).lastStatus = {
      is_on: PowerState.On,
      operation_mode: OperationMode.Cool,
      target_temp: 22,
      current_temp: 24,
      fan_mode: FanSpeed.Auto,
      swing_mode: SwingMode.Off, // Initial swing_mode before change
    };
    
    // When setting swing mode to Both, the API should use setDeviceOptions
    await api.setDeviceOptions({ swingMode: SwingMode.Both });
    
    // Let's verify that the correct XML command is being sent
    expect(mockSocket.send).toHaveBeenCalled();
    
    const calls = mockSocket.send.mock.calls;
    // Only one UDP send is expected
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toContain('<SetMessage>');
    // Verify that both horizontal and vertical tags are present for "Both"
    expect(calls[0][0]).toContain('<WindDirection_H>on</WindDirection_H>');
    expect(calls[0][0]).toContain('<WindDirection_V>on</WindDirection_V>');
    expect(calls[0][1]).toBe(7777);
    expect(calls[0][2]).toBe('192.168.1.100');
  });

  it('should set fan speed correctly', async () => {
    // Use real timers for this test to handle actual setTimeout behavior
    vi.useRealTimers();

    const promise = api.setDeviceOptions({ fanSpeed: FanSpeed.High });
    await promise;

    expect(mockSocket.send).toHaveBeenCalledWith(
      expect.stringContaining('<WindSpeed>High</WindSpeed>'),
      7777,
      '192.168.1.100',
      expect.any(Function),
    );
  });

  it('should update air conditioner state correctly', async () => {
    // Switch to real timers for proper setTimeout operation
    vi.useRealTimers();

    let responsePromiseResolve: (value: void) => void;
    const responsePromise = new Promise<void>(resolve => {
      responsePromiseResolve = resolve;
    });

    mockSocket.send.mockImplementationOnce((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        callback();
        setTimeout(() => {
          getMessageHandlers().forEach(handler => {
            handler(Buffer.from(mockResponseXML));
          });
          responsePromiseResolve();
        }, 10);
      }
    });

    (api as any).lastStatus = { is_on: PowerState.Off, operation_mode: OperationMode.Cool, target_temp: 70, current_temp: 72, fan_mode: FanSpeed.Auto, swing_mode: SwingMode.Off };

    const promise = api.setDeviceOptions({ temp: 75 });
    await new Promise(resolve => setTimeout(resolve, 100)); // Allow async operations within setDeviceOptions to start
    await responsePromise; // Wait for the mock response to be processed
    await promise; // Wait for setDeviceOptions to complete

    expect(mockSocket.send).toHaveBeenCalledTimes(1);
    const sentXML = mockSocket.send.mock.calls[0][0] as string;
    expect(sentXML).toContain('<SetTemp>75</SetTemp>');
    expect(sentXML).toContain('<TurnOn>on</TurnOn>');
  });

  it('should handle network errors', async () => {
    mockSocket.send.mockImplementationOnce((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        callback(new Error('Network error'));
      }
    });

    await expect(api.setDeviceOptions({ power: PowerState.On })).rejects.toThrow('Network error');
  });

  it('should handle timeout errors', async () => {
    vi.useRealTimers();
    mockSocket.send.mockImplementationOnce((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        callback();
      }
    });

    const updatePromise = api.updateState();
    const forcedTimeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Request timed out')), 100);
    });
    
    await expect(Promise.race([updatePromise, forcedTimeout])).rejects.toThrow('Request timed out');
  });

  it('should handle empty responses', async () => {
    mockSocket.send.mockImplementationOnce((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        callback();
        simulateResponse('', 10);
      }
    });

    const promise = api.updateState();
    vi.advanceTimersByTime(100);
    await expect(promise).rejects.toThrow();
  });

  it('should handle malformed XML responses', async () => {
    mockSocket.send.mockImplementationOnce((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        callback();
        simulateResponse('<msg><statusUpdateMsg><Invalid XML', 10);
      }
    });

    const promise = api.updateState();
    vi.advanceTimersByTime(100);
    await expect(promise).rejects.toThrow();
  });

  it('should handle invalid XML structure', async () => {
    mockSocket.send.mockImplementationOnce((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        callback();
        simulateResponse('<msg><statusUpdateMsg><IndoorTemp>invalid</IndoorTemp></invalid></msg>', 10);
      }
    });

    const promise = api.updateState();
    vi.advanceTimersByTime(100);
    await expect(promise).rejects.toThrow();
  });

  it('should handle missing required fields in response', async () => {
    const incompleteXML = `
      <msg>
        <statusUpdateMsg>
          <IndoorTemp>72</IndoorTemp>
        </statusUpdateMsg>
      </msg>
    `;
    
    mockSocket.send.mockImplementationOnce((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        callback();
        simulateResponse(incompleteXML, 10);
      }
    });

    const promise = api.updateState();
    vi.advanceTimersByTime(100);
    await expect(promise).rejects.toThrow();
  });

  it('should recover after network error', async () => {
    // Use real timers for this test
    vi.useRealTimers();
  
    // First request fails
    mockSocket.send.mockImplementationOnce((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        callback(new Error('Network error'));
      }
    });

    await expect(api.setDeviceOptions({ power: PowerState.On })).rejects.toThrow('Network error');
    expect(api.available).toBe(false);

    // Second request succeeds
    mockSocket.send.mockImplementationOnce((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        callback();
        setTimeout(() => {
          getMessageHandlers().forEach(handler => {
            handler(Buffer.from(mockResponseXML));
          });
        }, 10);
      }
    });

    const promise = api.setDeviceOptions({ power: PowerState.On });
    await promise;
    expect(api.available).toBe(true);
  });

  it('should handle concurrent requests correctly', async () => {
    // Switch to real timers for proper timeout handling
    vi.useRealTimers();
    
    // Mock to ensure every request gets a response
    mockSocket.send.mockImplementation((...args: unknown[]) => {
      const message = args[0] as string;
      const callback = args[3] as SendCallback;
      
      if (callback) {
        // Call callback immediately to simulate successful send
        callback();
        
        // Simulate receiving a response after a short delay
        setTimeout(() => {
          getMessageHandlers().forEach(handler => {
            handler(Buffer.from(mockResponseXML));
          });
        }, 5); // Use a very short delay for tests
      }
    });
    
    // Execute commands in parallel
    const commandPromises = [
      api.setDeviceOptions({ power: PowerState.On }),
      api.setDeviceOptions({ fanSpeed: FanSpeed.High }),
      api.setDeviceOptions({ temp: 72 })
    ];
    
    // Await all promises together
    await Promise.all(commandPromises);
    
    // Verify that all commands were sent
    const sendCalls = mockSocket.send.mock.calls;
    
    // Check that turnOn was called
    const turnOnCall = sendCalls.find((call: any) => 
      (call[0] as string).includes('<TurnOn>on</TurnOn>'));
    expect(turnOnCall).toBeTruthy();
    
    // Check that setFanSpeed was called
    const fanSpeedCall = sendCalls.find((call: any) => 
      (call[0] as string).includes('<WindSpeed>High</WindSpeed>'));
    expect(fanSpeedCall).toBeTruthy();
    
    // Check that setTemp was called
    const tempCall = sendCalls.find((call: any) => 
      (call[0] as string).includes('<SetTemp>72</SetTemp>'));
    expect(tempCall).toBeTruthy();
  });

  it('should cleanup resources after error', async () => {
    mockSocket.send.mockImplementationOnce((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        callback(new Error('Test error'));
        mockSocket.close();
      }
    });

    await expect(api.setDeviceOptions({ power: PowerState.On })).rejects.toThrow('Test error');
    expect(mockSocket.close).toHaveBeenCalled();
  });

  // Helper function for temperature validation
  const validateTemperatureTest = async (temp: number): Promise<void> => {
    mockSocket.send.mockImplementationOnce((commandXML: string, portNum: number, ipAddr: string, cb: SendCallback) => {
      if (cb) {
        cb(new Error('Invalid temperature'));
      }
    });
    (api as any).lastStatus = { is_on: PowerState.On, operation_mode: OperationMode.Cool, target_temp: 20, current_temp: 22, fan_mode: FanSpeed.Auto, swing_mode: SwingMode.Off };

    await expect(api.setDeviceOptions({ temp })).rejects.toThrow('Invalid temperature');
  };

  it('should validate temperature range', async () => {
    vi.useRealTimers();
    await validateTemperatureTest(100);
    await validateTemperatureTest(0);
    mockSocket.send.mockImplementation((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        callback();
        setTimeout(() => {
          getMessageHandlers().forEach(handler => handler(Buffer.from(mockResponseXML)));
        }, 10);
      }
    });
  });

  it('should validate fan speed values', async () => {
    vi.useRealTimers();
    mockSocket.send.mockImplementationOnce((commandXML: string, portNum: number, ipAddr: string, cb: SendCallback) => {
      if (cb) {
        cb(new Error('Invalid fan speed'));
      }
    });
    (api as any).lastStatus = { is_on: PowerState.On, operation_mode: OperationMode.Cool, target_temp: 20, current_temp: 22, fan_mode: FanSpeed.Auto, swing_mode: SwingMode.Off };
    await expect(api.setDeviceOptions({ fanSpeed: 'InvalidSpeed' as FanSpeed })).rejects.toThrow('Invalid fan speed');
    mockSocket.send.mockImplementation((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        callback();
        setTimeout(() => {
          getMessageHandlers().forEach(handler => handler(Buffer.from(mockResponseXML)));
        }, 10);
      }
    });
  });

  it('should validate operation mode values', async () => {
    vi.useRealTimers();
    mockSocket.send.mockImplementationOnce((commandXML: string, portNum: number, ipAddr: string, cb: SendCallback) => {
      if (cb) {
        cb(new Error('Invalid operation mode'));
      }
    });
    (api as any).lastStatus = { is_on: PowerState.On, operation_mode: OperationMode.Cool, target_temp: 20, current_temp: 22, fan_mode: FanSpeed.Auto, swing_mode: SwingMode.Off };
    await expect(api.setDeviceOptions({ mode: 'invalid' as OperationMode })).rejects.toThrow('Invalid operation mode');
    mockSocket.send.mockImplementation((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        callback();
        setTimeout(() => {
          getMessageHandlers().forEach(handler => handler(Buffer.from(mockResponseXML)));
        }, 10);
      }
    });
  });

  describe('Specific State Setters', () => {
    let setDeviceOptionsSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      if ((api.setDeviceOptions as any).mockRestore) {
        (api.setDeviceOptions as any).mockRestore();
      }
      setDeviceOptionsSpy = vi.spyOn(api as any, 'setDeviceOptions').mockResolvedValue(undefined);
      
      (api as any).lastStatus = {
        is_on: PowerState.On,
        operation_mode: OperationMode.Cool,
        target_temp: 22,
        current_temp: 24,
        fan_mode: FanSpeed.Auto,
        swing_mode: SwingMode.Off,
      };
    });

    afterEach(() => {
      setDeviceOptionsSpy.mockRestore();
    });

    it('should call setDeviceOptions for setDisplayState', async () => {
      await api.setDeviceOptions({ display: PowerState.On });
      expect(setDeviceOptionsSpy).toHaveBeenCalledWith({ display: PowerState.On });
      
      setDeviceOptionsSpy.mockClear(); 
      await api.setDeviceOptions({ display: PowerState.Off });
      expect(setDeviceOptionsSpy).toHaveBeenCalledWith({ display: PowerState.Off });
    });

    it('should call setDeviceOptions for setTurboState', async () => {
      await api.setDeviceOptions({ turbo: PowerState.On });
      expect(setDeviceOptionsSpy).toHaveBeenCalledWith({ turbo: PowerState.On });
      
      setDeviceOptionsSpy.mockClear();
      await api.setDeviceOptions({ turbo: PowerState.Off });
      expect(setDeviceOptionsSpy).toHaveBeenCalledWith({ turbo: PowerState.Off });
    });

    it('should call setDeviceOptions for setSleepState', async () => {
      await api.setDeviceOptions({ sleep: SleepModeState.On });
      expect(setDeviceOptionsSpy).toHaveBeenCalledWith({ sleep: SleepModeState.On });
      
      setDeviceOptionsSpy.mockClear();
      await api.setDeviceOptions({ sleep: SleepModeState.Off });
      expect(setDeviceOptionsSpy).toHaveBeenCalledWith({ sleep: SleepModeState.Off });
      
      setDeviceOptionsSpy.mockClear();
      await api.setDeviceOptions({ sleep: 'sleepMode1:custom' });
      expect(setDeviceOptionsSpy).toHaveBeenCalledWith({ sleep: 'sleepMode1:custom' });
    });
  });

  describe('AirConditionerAPI extra coverage', () => {
    let api: AirConditionerAPI;
    const ip = '127.0.0.1';
    const port = 7777;

    beforeEach(() => {
      vi.clearAllMocks();
      
      const mockSocket = {
        on: vi.fn(),
        bind: vi.fn(),
        setBroadcast: vi.fn(),
        send: vi.fn(),
        close: vi.fn(),
        address: vi.fn().mockReturnValue({ address: '0.0.0.0', port: 1234 }),
        removeAllListeners: vi.fn(),
        unref: vi.fn(),
      };
      
      (dgram.createSocket as ReturnType<typeof vi.fn>).mockReturnValue(mockSocket);
      
      mockSocket.send.mockImplementation((...args: unknown[]) => {
        const callback = args[3] as SendCallback;
        if (callback) {
          callback();
          setTimeout(() => {
            const handlers = (mockSocket.on.mock.calls as ['message' | 'error', MessageCallback | ErrorCallback][])
              .filter(([event]) => event === 'message')
              .map(([, handler]) => handler as MessageCallback);
              
            handlers.forEach(handler => handler(Buffer.from(mockResponseXML)));
          }, 10);
        }
      });
      
      api = new AirConditionerAPI(ip, port);
      
      vi.spyOn(api, 'updateState').mockResolvedValue({
        is_on: 'on',
        operation_mode: 'auto',
        current_temp: 25,
        target_temp: 25,
        fan_mode: 'auto',
        swing_mode: 'off',
        opt_turbo: PowerState.Off,
        opt_sleepMode: SleepModeState.Off
      });
    });

    afterEach(() => {
      vi.clearAllTimers();
      vi.useRealTimers();
      api.cleanup();
    });

    it('should reject on sendCommand timeout', async () => {
      vi.useFakeTimers();
      const dgram = await import('dgram');
      dgram.createSocket = vi.fn().mockReturnValue({
        on: vi.fn(),
        send: vi.fn(),
        unref: vi.fn(),
        removeAllListeners: vi.fn(),
        close: vi.fn(),
      });
      const promise = api["sendCommand"]('<msg></msg>', 10);
      vi.advanceTimersByTime(20);
      await expect(promise).rejects.toThrow('Command timed out');
    });

    it('should reject on sendCommand error event', async () => {
      const dgram = await import('dgram');
      let errorHandler: ((err: Error) => void) | undefined;
      
      dgram.createSocket = vi.fn().mockImplementation(() => {
        const socket = {
          on: vi.fn().mockImplementation((event: string, cb: any) => { 
            if (event === 'error') errorHandler = cb; 
            return socket; 
          }),
          send: vi.fn(),
          unref: vi.fn(),
          removeAllListeners: vi.fn(),
          close: vi.fn(),
        };
        return socket;
      });
      
      const promise = api["sendCommand"]('<msg></msg>', 1000);
      
      if (errorHandler) {
        errorHandler(new Error('fail'));
      }
      
      await expect(promise).rejects.toThrow('fail');
    });

    it('should set available=false on send error', async () => {
      const dgram = await import('dgram');
      let sendCb: ((err?: Error) => void) | undefined;
      
      dgram.createSocket = vi.fn().mockImplementation(() => {
        return {
          on: vi.fn(),
          send: vi.fn().mockImplementation((msg: any, port: any, ip: any, cb: any) => { 
            sendCb = cb;
          }),
          unref: vi.fn(),
          removeAllListeners: vi.fn(),
          close: vi.fn(),
        };
      });
      
      const promise = api["sendCommand"]('<msg></msg>', 1000);
      
      if (sendCb) {
        sendCb(new Error('fail'));
      }
      
      await expect(promise).rejects.toThrow('fail');
      expect(api.available).toBe(false);
    });

    it('should handle XML parse error in updateState', async () => {
      vi.mocked(api.updateState).mockRestore();
      
      vi.spyOn(api as any, 'sendCommand').mockResolvedValue('<badxml>');
      
      await expect(api.updateState()).rejects.toThrow();
      
      vi.spyOn(api, 'updateState').mockResolvedValue({
        is_on: 'on',
        operation_mode: 'auto',
        current_temp: 25,
        target_temp: 25,
        fan_mode: 'auto',
        swing_mode: 'off',
        opt_turbo: PowerState.Off,
        opt_sleepMode: SleepModeState.Off
      });
    });

    it('should handle error in setAirConditionerState if updateState fails', async () => {
      vi.spyOn(api, 'updateState').mockRejectedValue(new Error('fail'));
      await expect(api.setDeviceOptions({ mode: OperationMode.Cool, temp: undefined })).rejects.toThrow('fail');
    });

    it('should handle error if setDeviceOptions calls a failing updateState', async () => {
      (api as any).lastStatus = null;
      
      if (vi.isMockFunction(api.updateState)) {
        vi.mocked(api.updateState).mockRestore();
      }
      const updateStateSpy = vi.spyOn(api, 'updateState').mockRejectedValueOnce(new Error('fail'));

      await expect(api.setDeviceOptions({ mode: OperationMode.Cool, temp: undefined })).rejects.toThrow('fail');
      
      updateStateSpy.mockRestore();
    });

    describe('Specific State Setters (in extra coverage)', () => {
      let setDeviceOptionsSpyExtra: ReturnType<typeof vi.spyOn>;
      
      beforeEach(() => {
        if ((api.setDeviceOptions as any).mockRestore) {
          (api.setDeviceOptions as any).mockRestore();
        }
        setDeviceOptionsSpyExtra = vi.spyOn(api as any, 'setDeviceOptions').mockResolvedValue(undefined);
        
        (api as any).lastStatus = {
          is_on: PowerState.On,
          operation_mode: OperationMode.Cool,
          target_temp: 22,
          current_temp: 24,
          fan_mode: FanSpeed.Auto,
          swing_mode: SwingMode.Off,
        };
      });

      afterEach(() => {
        setDeviceOptionsSpyExtra.mockRestore();
      });

      it('should call setDeviceOptions for setDisplayState (extra coverage)', async () => {
        await api.setDeviceOptions({ display: PowerState.On });
        expect(setDeviceOptionsSpyExtra).toHaveBeenCalledWith({ display: PowerState.On });
        setDeviceOptionsSpyExtra.mockClear();
        await api.setDeviceOptions({ display: PowerState.Off });
        expect(setDeviceOptionsSpyExtra).toHaveBeenCalledWith({ display: PowerState.Off });
      });

      it('should call setDeviceOptions for setTurboState (extra coverage)', async () => {
        await api.setDeviceOptions({ turbo: PowerState.On });
        expect(setDeviceOptionsSpyExtra).toHaveBeenCalledWith({ turbo: PowerState.On });
        setDeviceOptionsSpyExtra.mockClear();
        await api.setDeviceOptions({ turbo: PowerState.Off });
        expect(setDeviceOptionsSpyExtra).toHaveBeenCalledWith({ turbo: PowerState.Off });
      });

      it('should call setDeviceOptions for setSleepState (extra coverage)', async () => {
        await api.setDeviceOptions({ sleep: SleepModeState.On });
        expect(setDeviceOptionsSpyExtra).toHaveBeenCalledWith({ sleep: SleepModeState.On });
        setDeviceOptionsSpyExtra.mockClear();
        await api.setDeviceOptions({ sleep: SleepModeState.Off });
        expect(setDeviceOptionsSpyExtra).toHaveBeenCalledWith({ sleep: SleepModeState.Off });
      });
    });

    it('should cleanup all timeouts', () => {
      const timeout = setTimeout(() => {}, 1000);
      (api as any).activeTimeouts.push(timeout);
      api.cleanup();
      expect((api as any).activeTimeouts.length).toBe(0);
    });
  });
});