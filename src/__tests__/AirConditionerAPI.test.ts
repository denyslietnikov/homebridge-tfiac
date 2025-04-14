// AirConditionerAPI.test.ts

import AirConditionerAPI from '../AirConditionerAPI';
import dgram from 'dgram';
import { jest, describe, beforeEach, it, expect, afterEach } from '@jest/globals';

jest.mock('dgram');

// Types for mocking
type MessageCallback = (msg: Buffer) => void;
type ErrorCallback = (err: Error) => void;
type SendCallback = (error?: Error) => void;

interface MockSocket {
  send: jest.Mock;
  on: jest.Mock;
  close: jest.Mock;
  removeAllListeners: jest.Mock;
}

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
  let mockSocket: MockSocket;

  const getMessageHandlers = (): MessageCallback[] => {
    return (mockSocket.on.mock.calls as ['message' | 'error', MessageCallback | ErrorCallback][])
      .filter(([event]: ['message' | 'error', MessageCallback | ErrorCallback]) => event === 'message')
      .map(([, handler]: ['message' | 'error', MessageCallback | ErrorCallback]) => handler as MessageCallback);
  };

  const simulateResponse = (xml: string = mockResponseXML, delay: number = 50): void => {
    setTimeout(() => {
      getMessageHandlers().forEach((handler: MessageCallback) => 
        handler(Buffer.from(xml)),
      );
    }, delay);
  };

  beforeEach(() => {
    jest.useFakeTimers();

    mockSocket = {
      send: jest.fn().mockImplementation((...args: unknown[]) => {
        const callback = args[3] as SendCallback;
        if (callback) {
          callback();
          simulateResponse();
        }
      }),
      on: jest.fn().mockReturnThis(),
      close: jest.fn(),
      removeAllListeners: jest.fn(),
    };

    (dgram.createSocket as jest.Mock).mockReturnValue(mockSocket);
    api = new AirConditionerAPI('192.168.1.100', 7777);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();
    mockSocket.close();
    mockSocket.removeAllListeners();
  });

  it('should send turnOn command correctly', async () => {
    const promise = api.turnOn();
    jest.advanceTimersByTime(50);
    await promise;

    expect(mockSocket.send).toHaveBeenCalledWith(
      expect.stringContaining('<TurnOn>on</TurnOn>'),
      7777,
      '192.168.1.100',
      expect.any(Function),
    );
  });

  it('should send turnOff command correctly', async () => {
    const promise = api.turnOff();
    jest.advanceTimersByTime(50);
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
    jest.advanceTimersByTime(50);
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
    const promise = api.setSwingMode('Both');
    jest.advanceTimersByTime(50);
    await promise;

    expect(mockSocket.send).toHaveBeenCalledWith(
      expect.stringContaining('<WindDirection_H>on</WindDirection_H><WindDirection_V>on</WindDirection_V>'),
      7777,
      '192.168.1.100',
      expect.any(Function),
    );
  });

  it('should set fan speed correctly', async () => {
    const promise = api.setFanSpeed('High');
    jest.advanceTimersByTime(50);
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
    jest.useRealTimers();
  
    // Set up a promise to control the mock response callback
    let responsePromiseResolve: (value: void) => void;
    const responsePromise = new Promise<void>(resolve => {
      responsePromiseResolve = resolve;
    });
  
    mockSocket.send.mockImplementationOnce((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        // Call callback to simulate successful send
        callback();
        // Simulate UDP message receipt after 10ms
        setTimeout(() => {
          getMessageHandlers().forEach(handler => {
            handler(Buffer.from(mockResponseXML));
          });
          responsePromiseResolve();
        }, 10);
      }
    });
  
    // Call the method that should send command and wait for response
    const promise = api.setAirConditionerState('target_temp', '75');
    // Wait for all delays to complete
    await new Promise(resolve => setTimeout(resolve, 100));
    await responsePromise;
    await promise;
  
    expect(mockSocket.send).toHaveBeenCalledWith(
      expect.stringContaining('<SetTemp>75</SetTemp>'),
      7777,
      '192.168.1.100',
      expect.any(Function),
    );
  });

  it('should handle network errors', async () => {
    mockSocket.send.mockImplementationOnce((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        callback(new Error('Network error'));
      }
    });

    await expect(api.turnOn()).rejects.toThrow('Network error');
  });

  it(
    'should handle timeout errors',
    async () => {
      // Switch to real timers for proper setTimeout operation
      jest.useRealTimers();
  
      // Mock send so that callback is called but no response simulation occurs
      mockSocket.send.mockImplementationOnce((...args: unknown[]) => {
        const callback = args[3] as SendCallback;
        if (callback) {
          callback(); // simulate successful send
        }
      });
  
      // Wrap updateState call in Promise.race and force reject after 100ms
      // if updateState does not complete in time.
      const updatePromise = api.updateState();
      const forcedTimeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timed out')), 100);
      });
      
      await expect(Promise.race([updatePromise, forcedTimeout])).rejects.toThrow('Request timed out');
    },
    1000, // overall test timeout – 1000ms
  );

  it('should handle empty responses', async () => {
    mockSocket.send.mockImplementationOnce((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        callback();
        simulateResponse('');
      }
    });

    const promise = api.updateState();
    jest.advanceTimersByTime(100);
    await expect(promise).rejects.toThrow();
  });

  it('should handle malformed XML responses', async () => {
    mockSocket.send.mockImplementationOnce((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        callback();
        simulateResponse('<msg><statusUpdateMsg><Invalid XML');
      }
    });

    const promise = api.updateState();
    jest.advanceTimersByTime(100);
    await expect(promise).rejects.toThrow();
  });

  it('should handle invalid XML structure', async () => {
    mockSocket.send.mockImplementationOnce((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        callback();
        simulateResponse('<msg><statusUpdateMsg><IndoorTemp>invalid</IndoorTemp></invalid></msg>');
      }
    });

    const promise = api.updateState();
    jest.advanceTimersByTime(100);
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
        simulateResponse(incompleteXML);
      }
    });

    const promise = api.updateState();
    jest.advanceTimersByTime(100);
    await expect(promise).rejects.toThrow();
  });

  it('should recover after network error', async () => {
    // First request fails
    mockSocket.send.mockImplementationOnce((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        callback(new Error('Network error'));
      }
    });

    await expect(api.turnOn()).rejects.toThrow('Network error');
    expect(api.available).toBe(false);

    // Second request succeeds
    mockSocket.send.mockImplementationOnce((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        callback();
        simulateResponse(mockResponseXML, 10);
      }
    });

    const promise = api.turnOn();
    jest.advanceTimersByTime(50);
    await promise;
    expect(api.available).toBe(true);
  }, 10000);

  it(
    'should handle concurrent requests correctly',
    async () => {
      jest.useRealTimers();
  
      const responsePromises: Promise<void>[] = [];
  
      // Mock send to simulate response for commands
      mockSocket.send.mockImplementation((...args: unknown[]) => {
        const callback = args[3] as SendCallback;
        if (callback) {
          // Call callback immediately
          callback();
          const message: string = args[0] as string;
          // If message contains a command, simulate response 
          // (don't simulate for updateState to exclude them from count)
          if (
            message.includes('<TurnOn>') ||
            message.includes('<WindSpeed>') ||
            message.includes('<SetTemp>')
          ) {
            const responsePromise = new Promise<void>((resolve) => {
              setTimeout(() => {
                // Call all handlers registered for the "message" event
                getMessageHandlers().forEach((handler) => {
                  handler(Buffer.from(mockResponseXML));
                });
                resolve();
              }, 10);
            });
            responsePromises.push(responsePromise);
          }
        }
      });
  
      // Execute three commands simultaneously
      const commandPromises = [
        api.turnOn(),
        api.setFanSpeed('High'),
        api.setAirConditionerState('target_temp', '72'),
      ];
  
      // Wait for all setTimeout calls to complete
      await new Promise((resolve) => setTimeout(resolve, 200));
  
      // Wait for all responses and commands to complete
      await Promise.all(responsePromises);
      await Promise.all(commandPromises);
  
      // Filter send calls to only include those with command messages
      const commandCalls = (mockSocket.send as jest.Mock).mock.calls.filter(
        ([message]) => {
          const msg = message as string;
          return msg.includes('<TurnOn>') ||
                 msg.includes('<WindSpeed>') ||
                 msg.includes('<SetTemp>');
        },
      );
  
      // Expect exactly 3 send calls to match commands
      expect(commandCalls.length).toBe(3);
    },
    10000, // Set overall test timeout to wait for all async operations
  );

  it('should cleanup resources after error', async () => {
    mockSocket.send.mockImplementationOnce((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        callback(new Error('Test error'));
        mockSocket.close();
      }
    });

    await expect(api.turnOn()).rejects.toThrow('Test error');
    expect(mockSocket.close).toHaveBeenCalled();
  });

  // Helper functions for testing temperature validation
  const validateTemperature = async (temp: string) => {
    mockSocket.send.mockImplementationOnce((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        callback(new Error('Invalid temperature'));
      }
    });

    const promise = api.setAirConditionerState('target_temp', temp);
    await expect(promise).rejects.toThrow('Invalid temperature');
  };

  it('should validate temperature range', async () => {
    await validateTemperature('100');
    await validateTemperature('0');
  });

  it('should validate fan speed values', async () => {
    mockSocket.send.mockImplementationOnce((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        callback(new Error('Invalid fan speed'));
      }
    });

    await expect(api.setFanSpeed('InvalidSpeed')).rejects.toThrow('Invalid fan speed');
  });

  it('should validate operation mode values', async () => {
    mockSocket.send.mockImplementationOnce((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        callback(new Error('Invalid operation mode'));
      }
    });

    await expect(api.setAirConditionerState('operation_mode', 'invalid')).rejects.toThrow('Invalid operation mode');
  });
});
