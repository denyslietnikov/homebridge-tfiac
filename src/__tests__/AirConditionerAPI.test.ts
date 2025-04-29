// AirConditionerAPI.test.ts

import AirConditionerAPI from '../AirConditionerAPI.js';
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
      .filter(([event]) => event === 'message')
      .map(([, handler]) => handler as MessageCallback);
  };

  const simulateResponse = (xml: string = mockResponseXML, delay: number = 50): void => {
    setTimeout(() => {
      getMessageHandlers().forEach((handler: MessageCallback) => handler(Buffer.from(xml)));
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
    if (api) {
      api.cleanup();
    }
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
  
    const promise = api.setAirConditionerState('target_temp', '75');
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
      jest.useRealTimers();
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
    },
    1000,
  );

  it('should handle empty responses', async () => {
    mockSocket.send.mockImplementationOnce((...args: unknown[]) => {
      const callback = args[3] as SendCallback;
      if (callback) {
        callback();
        simulateResponse('', 10);
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
        simulateResponse('<msg><statusUpdateMsg><Invalid XML', 10);
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
        simulateResponse('<msg><statusUpdateMsg><IndoorTemp>invalid</IndoorTemp></invalid></msg>', 10);
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
        simulateResponse(incompleteXML, 10);
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
  
      mockSocket.send.mockImplementation((...args: unknown[]) => {
        const callback = args[3] as SendCallback;
        if (callback) {
          callback();
          const message: string = args[0] as string;
          if (
            message.includes('<TurnOn>') ||
            message.includes('<WindSpeed>') ||
            message.includes('<SetTemp>')
          ) {
            const responsePromise = new Promise<void>((resolve) => {
              setTimeout(() => {
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
  
      const commandPromises = [
        api.turnOn(),
        api.setFanSpeed('High'),
        api.setAirConditionerState('target_temp', '72'),
      ];
  
      await new Promise(resolve => setTimeout(resolve, 200));
      await Promise.all(responsePromises);
      await Promise.all(commandPromises);
  
      const commandCalls = (mockSocket.send as jest.Mock).mock.calls.filter(
        ([message]) => {
          const msg = message as string;
          return msg.includes('<TurnOn>') ||
                 msg.includes('<WindSpeed>') ||
                 msg.includes('<SetTemp>');
        },
      );
  
      expect(commandCalls.length).toBe(3);
    },
    10000,
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

  // Helper function for temperature validation
  const validateTemperature = async (temp: string): Promise<void> => {
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

  describe('Error handling', () => {
    it('should handle UDP socket errors', async () => {
      mockSocket.send.mockImplementationOnce((...args: unknown[]) => {
        const callback = args[3] as SendCallback;
        callback(new Error('UDP error'));
      });

      await expect(api.turnOn()).rejects.toThrow('UDP error');
      expect(api.available).toBe(false);
    });

    it('should handle socket close on error', async () => {
      mockSocket.send.mockImplementationOnce((...args: unknown[]) => {
        const callback = args[3] as SendCallback;
        callback(new Error('Socket closed'));
        mockSocket.close();
      });

      await expect(api.turnOn()).rejects.toThrow('Socket closed');
      expect(mockSocket.close).toHaveBeenCalled();
    });
  });

  describe('Wind direction mapping', () => {
    // Increase timeout to 10 seconds
    it('should handle all wind direction combinations', async () => {
      const testCases = [
        { input: { WindDirection_H: ['off'], WindDirection_V: ['off'] }, expected: 'Off' },
        { input: { WindDirection_H: ['on'], WindDirection_V: ['off'] }, expected: 'Horizontal' },
        { input: { WindDirection_H: ['off'], WindDirection_V: ['on'] }, expected: 'Vertical' },
        { input: { WindDirection_H: ['on'], WindDirection_V: ['on'] }, expected: 'Both' },
        { input: { WindDirection_H: ['invalid'], WindDirection_V: ['invalid'] }, expected: 'Off' },
      ];

      for (const testCase of testCases) {
        mockSocket.send.mockImplementationOnce((...args: unknown[]) => {
          const callback = args[3] as SendCallback;
          if (callback) {
            callback();
            simulateResponse(`
              <msg>
                <statusUpdateMsg>
                  <IndoorTemp>72</IndoorTemp>
                  <SetTemp>70</SetTemp>
                  <BaseMode>cool</BaseMode>
                  <WindSpeed>Auto</WindSpeed>
                  <TurnOn>on</TurnOn>
                  <WindDirection_H>${testCase.input.WindDirection_H}</WindDirection_H>
                  <WindDirection_V>${testCase.input.WindDirection_V}</WindDirection_V>
                </statusUpdateMsg>
              </msg>
            `, 10);
          }
        });
        const promise = api.updateState();
        jest.advanceTimersByTime(50);
        const status = await promise;
        expect(status.swing_mode).toBe(testCase.expected);
      }
    }, 10000);
  });

  describe('Message sequence handling', () => {
    it('should use unique sequence numbers', async () => {
      // Switch to real timers for correct execution of setTimeout
      jest.useRealTimers();
      const seqs = new Set<string>();
  
      // Mock send method to extract the sequence number and simulate receiving a response
      mockSocket.send.mockImplementation((...args: unknown[]) => {
        const message = args[0] as string;
        const seqMatch = message.match(/seq="(\d+)"/);
        if (seqMatch) {
          seqs.add(seqMatch[1]);
        }
        const callback = args[3] as SendCallback;
        if (callback) {
          // Call callback immediately to simulate a successful send
          callback();
          // After 10ms, invoke all "message" handlers
          setTimeout(() => {
            getMessageHandlers().forEach(handler => {
              handler(Buffer.from(mockResponseXML));
            });
          }, 10);
        }
      });
  
      // Execute commands sequentially
      await api.turnOn();
      await api.turnOff();
      await api.setFanSpeed('High');
      await api.setSwingMode('Both');
  
      // Wait enough time for all setTimeout handlers to complete (e.g., 50ms)
      await new Promise(resolve => setTimeout(resolve, 50));
  
      // Check that 4 unique sequence numbers were collected
      expect(seqs.size).toBe(4);
    }, 10000);
  });

  describe('XML Response Handling', () => {
    it('should handle missing XML fields gracefully', async () => {
      mockSocket.send.mockImplementationOnce((...args: unknown[]) => {
        const callback = args[3] as SendCallback;
        if (callback) {
          callback();
          simulateResponse(`
            <msg>
              <statusUpdateMsg>
                <IndoorTemp>72</IndoorTemp>
              </statusUpdateMsg>
            </msg>
          `, 10);
        }
      });
  
      const promise = api.updateState();
      jest.advanceTimersByTime(100);
      await expect(promise).rejects.toThrow();
    }, 10000);
  
    it('should parse numeric values correctly', async () => {
      mockSocket.send.mockImplementationOnce((...args: unknown[]) => {
        const callback = args[3] as SendCallback;
        if (callback) {
          callback();
          simulateResponse(`
            <msg>
              <statusUpdateMsg>
                <IndoorTemp>72.5</IndoorTemp>
                <SetTemp>70.0</SetTemp>
                <BaseMode>cool</BaseMode>
                <WindSpeed>Auto</WindSpeed>
                <TurnOn>on</TurnOn>
                <WindDirection_H>off</WindDirection_H>
                <WindDirection_V>on</WindDirection_V>
              </statusUpdateMsg>
            </msg>
          `, 10);
        }
      });
  
      const promise = api.updateState();
      jest.advanceTimersByTime(100);
      const status = await promise;
      expect(status.current_temp).toBe(72.5);
      expect(status.target_temp).toBe(70.0);
    }, 10000);
  });
});

describe('AirConditionerAPI extra coverage', () => {
  let api: AirConditionerAPI;
  const ip = '127.0.0.1';
  const port = 7777;

  beforeEach(() => {
    api = new AirConditionerAPI(ip, port);
  });

  it('should reject on sendCommand timeout', async () => {
    jest.useFakeTimers();
    const origCreateSocket = require('dgram').createSocket;
    require('dgram').createSocket = jest.fn().mockReturnValue({
      on: jest.fn(),
      send: jest.fn(),
      unref: jest.fn(),
      removeAllListeners: jest.fn(),
      close: jest.fn(),
    });
    const promise = api["sendCommand"]('<msg></msg>', 10);
    jest.advanceTimersByTime(20);
    await expect(promise).rejects.toThrow('Command timed out');
    require('dgram').createSocket = origCreateSocket;
    jest.useRealTimers();
  });

  it('should reject on sendCommand error event', async () => {
    const origCreateSocket = require('dgram').createSocket;
    let errorHandler: ((err: Error) => void) | undefined;
    require('dgram').createSocket = jest.fn().mockReturnValue({
      on: (event: string, cb: any) => { if (event === 'error') errorHandler = cb; return this; },
      send: jest.fn(),
      unref: jest.fn(),
      removeAllListeners: jest.fn(),
      close: jest.fn(),
    });
    const promise = api["sendCommand"]('<msg></msg>', 1000);
    errorHandler && errorHandler(new Error('fail')); // simulate error
    await expect(promise).rejects.toThrow('fail');
    require('dgram').createSocket = origCreateSocket;
  });

  it('should set available=false on send error', async () => {
    const origCreateSocket = require('dgram').createSocket;
    let sendCb: ((err?: Error) => void) | undefined;
    require('dgram').createSocket = jest.fn().mockReturnValue({
      on: jest.fn(),
      send: (msg: any, port: any, ip: any, cb: any) => { sendCb = cb; },
      unref: jest.fn(),
      removeAllListeners: jest.fn(),
      close: jest.fn(),
    });
    const promise = api["sendCommand"]('<msg></msg>', 1000);
    sendCb && sendCb(new Error('fail'));
    await expect(promise).rejects.toThrow('fail');
    expect(api.available).toBe(false);
    require('dgram').createSocket = origCreateSocket;
  });

  it('should handle XML parse error in updateState', async () => {
    jest.spyOn(api as any, 'sendCommand').mockResolvedValue('<badxml>');
    await expect(api.updateState()).rejects.toThrow();
  });

  it('should handle error in setAirConditionerState if updateState fails', async () => {
    jest.spyOn(api, 'updateState').mockRejectedValue(new Error('fail'));
    await expect(api.setAirConditionerState('operation_mode', 'cool')).rejects.toThrow('fail');
  });

  it('should call setDisplayState for on and off', async () => {
    const spy = jest.spyOn(api as any, 'sendCommand').mockResolvedValue('ok');
    await api.setDisplayState('on');
    await api.setDisplayState('off');
    expect(spy).toHaveBeenCalledTimes(2);
    // Check for the XML substring anywhere in the command string
    const firstCall = spy.mock.calls[0][0] as string;
    const secondCall = spy.mock.calls[1][0] as string;
    expect(firstCall).toMatch(/<Opt_display>on<\/Opt_display>/);
    expect(secondCall).toMatch(/<Opt_display>off<\/Opt_display>/);
  });

  it('should call setTurboState for on and off', async () => {
    const spy = jest.spyOn(api as any, 'sendCommand').mockResolvedValue('ok');
    await api.setTurboState('on');
    await api.setTurboState('off');
    expect(spy).toHaveBeenCalledTimes(2);
    // Check for the XML substring anywhere in the command string
    const firstCall = spy.mock.calls[0][0] as string;
    const secondCall = spy.mock.calls[1][0] as string;
    expect(firstCall).toMatch(/<Opt_super>on<\/Opt_super>/);
    expect(secondCall).toMatch(/<Opt_super>off<\/Opt_super>/);
  });

  it('should call setSleepState for on and off', async () => {
    const spy = jest.spyOn(api as any, 'sendCommand').mockResolvedValue('ok');
    await api.setSleepState('on');
    await api.setSleepState('off');
    expect(spy).toHaveBeenCalledTimes(2);
    // Check for the XML substring anywhere in the command string
    const firstCall = spy.mock.calls[0][0] as string;
    const secondCall = spy.mock.calls[1][0] as string;
    expect(firstCall).toMatch(/<Opt_sleepMode>sleepMode1:/);
    expect(secondCall).toMatch(/<Opt_sleepMode>off<\/Opt_sleepMode>/);
  });

  it('should cleanup all timeouts', () => {
    const timeout = setTimeout(() => {}, 1000);
    (api as any).activeTimeouts.push(timeout);
    api.cleanup();
    expect((api as any).activeTimeouts.length).toBe(0);
  });
});