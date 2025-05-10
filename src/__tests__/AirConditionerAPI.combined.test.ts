import { vi, describe, beforeEach, it, expect, afterEach } from 'vitest';
import { PowerState, OperationMode, FanSpeed, SwingMode, SleepModeState } from '../enums.js'; // Import enums

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
      <Opt_super>off</Opt_super>
      <Opt_sleepMode>off</Opt_sleepMode>
    </statusUpdateMsg>
  </msg>
`;

describe('AirConditionerAPI - Combined Commands', () => {
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
    // Add a spy on emit
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

  describe('setFanAndSleepState', () => {
    it('should send combined command for fan speed and sleep state', async () => {
      vi.useRealTimers();
      
      // Mock the last status to test cache updates
      (api as any).lastStatus = {
        is_on: PowerState.On,
        opt_sleepMode: SleepModeState.Off,
        opt_sleep: PowerState.Off,
        opt_turbo: PowerState.Off,
        fan_mode: FanSpeed.Auto
      };
      
      // Call the method
      const promise = api.setFanAndSleepState(FanSpeed.Low, SleepModeState.On);
      
      // Need to wait for promise resolution
      await promise;
      
      // Check if the socket send was called with correct XML
      expect(mockSocket.send).toHaveBeenCalled();
      const sendArgs = mockSocket.send.mock.calls[0];
      const command = sendArgs[0].toString();
      
      // Verify command contains all the expected tags
      expect(command).toContain('<Opt_super>off</Opt_super>');
      expect(command).toContain(`<WindSpeed>${FanSpeed.Low}</WindSpeed>`);
      expect(command).toContain(`<Opt_sleep>${SleepModeState.On}</Opt_sleep>`);
      expect(command).toContain(`<Opt_sleepMode>${SleepModeState.On}</Opt_sleepMode>`);
      
      // Should update the cached status
      expect((api as any).lastStatus).toEqual(expect.objectContaining({
        fan_mode: FanSpeed.Low,
        opt_sleep: PowerState.On,
        opt_sleepMode: SleepModeState.On,
        opt_turbo: PowerState.Off
      }));
      
      // Should emit the status event with the updated status
      expect(api.emit).toHaveBeenCalledWith('status', expect.objectContaining({
        fan_mode: FanSpeed.Low,
        opt_sleep: PowerState.On,
        opt_sleepMode: SleepModeState.On,
        opt_turbo: PowerState.Off
      }));
    });
  });

  describe('setTurboAndSleep', () => {
    it('should send combined command to disable turbo and set sleep mode', async () => {
      vi.useRealTimers();
      
      // Mock the last status to test cache updates
      (api as any).lastStatus = {
        is_on: PowerState.On,
        opt_sleepMode: SleepModeState.Off,
        opt_sleep: PowerState.Off,
        opt_turbo: PowerState.On,
        fan_mode: FanSpeed.Auto
      };
      
      // Call the method
      const promise = api.setTurboAndSleep(FanSpeed.Low, SleepModeState.On);
      
      // Need to wait for promise resolution
      await promise;
      
      // Check if the socket send was called with correct XML
      expect(mockSocket.send).toHaveBeenCalled();
      const sendArgs = mockSocket.send.mock.calls[0];
      const command = sendArgs[0].toString();
      
      // Verify command contains all the expected tags
      expect(command).toContain('<Opt_super>off</Opt_super>');
      expect(command).toContain(`<WindSpeed>${FanSpeed.Low}</WindSpeed>`);
      expect(command).toContain(`<Opt_sleepMode>${SleepModeState.On}</Opt_sleepMode>`);
      
      // Should update the cached status
      expect((api as any).lastStatus).toEqual(expect.objectContaining({
        fan_mode: FanSpeed.Low,
        opt_turbo: PowerState.Off,
        opt_sleepMode: SleepModeState.On
      }));
      
      // Should emit the status event
      expect(api.emit).toHaveBeenCalledWith('status', expect.objectContaining({
        fan_mode: FanSpeed.Low,
        opt_turbo: PowerState.Off,
        opt_sleepMode: SleepModeState.On
      }));
    });
  });

  describe('setSleepAndTurbo', () => {
    it('should send combined command to set sleep and enable turbo', async () => {
      vi.useRealTimers();
      
      // Mock the last status to test cache updates
      (api as any).lastStatus = {
        is_on: PowerState.On,
        opt_sleepMode: SleepModeState.On,
        opt_sleep: PowerState.On,
        opt_turbo: PowerState.Off,
        fan_mode: FanSpeed.Low
      };
      
      // Call the method
      const promise = api.setSleepAndTurbo(FanSpeed.High, SleepModeState.Off);
      
      // Need to wait for promise resolution
      await promise;
      
      // Check if the socket send was called with correct XML
      expect(mockSocket.send).toHaveBeenCalled();
      const sendArgs = mockSocket.send.mock.calls[0];
      const command = sendArgs[0].toString();
      
      // Verify command contains all the expected tags
      expect(command).toContain('<Opt_sleepMode>off</Opt_sleepMode>');
      expect(command).toContain('<Opt_super>on</Opt_super>');
      expect(command).toContain(`<WindSpeed>${FanSpeed.High}</WindSpeed>`);
      
      // Should update the cached status
      expect((api as any).lastStatus).toEqual(expect.objectContaining({
        fan_mode: FanSpeed.High,
        opt_sleep: PowerState.Off,
        opt_sleepMode: SleepModeState.Off,
        opt_turbo: PowerState.On
      }));
      
      // Should emit the status event
      expect(api.emit).toHaveBeenCalledWith('status', (api as any).lastStatus);
    });
  });

  describe('setSleepState', () => {
    it('should update the cache optimistically when setting sleep state', async () => {
      vi.useRealTimers();
      
      // Mock the last status to test cache updates
      (api as any).lastStatus = {
        is_on: PowerState.On,
        opt_sleepMode: SleepModeState.Off,
        opt_sleep: PowerState.Off,
        opt_turbo: PowerState.Off,
        fan_mode: FanSpeed.Auto
      };
      
      // Call the method
      const promise = api.setSleepState(SleepModeState.On);
      
      // Need to wait for promise resolution
      await promise;
      
      // Check if the socket send was called
      expect(mockSocket.send).toHaveBeenCalled();
      
      // Should update the cached status to reflect sleep on
      expect((api as any).lastStatus).toEqual(expect.objectContaining({
        opt_sleep: PowerState.On,
        opt_sleepMode: SleepModeState.On
      }));
      
      // Should emit the status event
      expect(api.emit).toHaveBeenCalledWith('status', (api as any).lastStatus);
    });
     it('should handle special case when turbo is active', async () => {
      vi.useRealTimers();

      // First intercept the updateState call to return status with turbo active
      const mockStatus = {
        is_on: PowerState.On,
        operation_mode: 'cool',
        target_temp: 22,
        current_temp: 24,
        fan_mode: FanSpeed.Turbo,
        swing_mode: 'vertical',
        opt_turbo: PowerState.On,
        opt_sleepMode: SleepModeState.Off,
        opt_sleep: PowerState.Off
      };
      
      // Mock updateState to return the mock status
      vi.spyOn(api, 'updateState').mockResolvedValue(mockStatus);
      
      // Set up the internal status
      (api as any).lastStatus = { ...mockStatus };
      
      // Set up a spy on setOptionState (first call) and sendCommandWithRetry (second call with combined command)
      const setOptionStateSpy = vi.spyOn(api as any, 'setOptionState');
      const sendCommandWithRetrySpy = vi.spyOn(api as any, 'sendCommandWithRetry');
      
      // Make both methods return successfully without actually sending anything
      setOptionStateSpy.mockResolvedValue(undefined);
      sendCommandWithRetrySpy.mockResolvedValue('<msg><SetResponse>success</SetResponse></msg>');
      
      // Call the method to test
      await api.setSleepState(SleepModeState.On);
      
      // Should have called setOptionState to disable Turbo
      expect(setOptionStateSpy).toHaveBeenCalledWith('Opt_super', PowerState.Off);
      
      // Should have called sendCommandWithRetry with a command containing both WindSpeed and Opt_sleepMode
      expect(sendCommandWithRetrySpy).toHaveBeenCalledWith(expect.stringContaining('<WindSpeed>Low</WindSpeed>'));
      expect(sendCommandWithRetrySpy).toHaveBeenCalledWith(expect.stringContaining('<Opt_sleepMode>sleepMode1:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0</Opt_sleepMode>'));
    });
  });

  describe('setBeepState', () => {
    it('should send the correct command to set beep on', async () => {
      vi.useRealTimers();
      
      // Call the method
      const promise = api.setBeepState(PowerState.On);
      
      // Need to wait for promise resolution
      await promise;
      
      // Check if the socket send was called
      expect(mockSocket.send).toHaveBeenCalled();
      const sendArgs = mockSocket.send.mock.calls[0];
      const command = sendArgs[0].toString();
      
      // Verify command contains the expected tag
      expect(command).toContain('<Opt_beep>on</Opt_beep>');
      
      // Should emit debug event with setBeepState information
      expect(api.emit).toHaveBeenCalledWith('debug', expect.stringContaining('[setBeepState]'));
    });
    
    it('should send the correct command to set beep off', async () => {
      vi.useRealTimers();
      
      // Call the method
      const promise = api.setBeepState(PowerState.Off);
      
      // Need to wait for promise resolution
      await promise;
      
      // Check if the socket send was called
      expect(mockSocket.send).toHaveBeenCalled();
      const sendArgs = mockSocket.send.mock.calls[0];
      const command = sendArgs[0].toString();
      
      // Verify command contains the expected tag
      expect(command).toContain('<Opt_beep>off</Opt_beep>');
    });
  });
});
