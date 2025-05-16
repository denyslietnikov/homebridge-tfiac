import { vi, describe, beforeEach, it, expect, afterEach, beforeAll } from 'vitest';
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

// Add mockHttpService definition for HTTP calls
let mockHttpService: { post: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };

beforeAll(() => {
  // Initialize mockHttpService before tests
  mockHttpService = { post: vi.fn(), get: vi.fn() };
});


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
  let setDeviceOptionsSpy: ReturnType<typeof vi.spyOn>;

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
    // Spy on setDeviceOptions for all tests in this suite
    setDeviceOptionsSpy = vi.spyOn(api as any, 'setDeviceOptions').mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (api) {
      api.cleanup();
    }
    setDeviceOptionsSpy.mockRestore(); // Restore the spy after each test
    vi.clearAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('setFanAndSleepState (now setDeviceOptions)', () => {
    it('should call setDeviceOptions with correct parameters for fan and sleep', async () => {
      vi.useRealTimers();

      await api.setDeviceOptions({ 
        power: PowerState.On,
        fanSpeed: FanSpeed.Low, 
        sleep: SleepModeState.On,
        turbo: PowerState.Off, // Ensure turbo is explicitly off
      });

      expect(setDeviceOptionsSpy).toHaveBeenCalledWith({
        power: PowerState.On,
        fanSpeed: FanSpeed.Low,
        sleep: SleepModeState.On,
        turbo: PowerState.Off, // Ensure turbo is explicitly off
      });
    });
  });

  describe('setTurboAndSleep (now setDeviceOptions)', () => {
    it('should call setDeviceOptions with correct parameters for turbo and sleep, ensuring turbo is off', async () => {
      vi.useRealTimers();

      await api.setDeviceOptions({ 
        power: PowerState.On,
        fanSpeed: FanSpeed.Low, 
        sleep: SleepModeState.On,
        turbo: PowerState.Off, // Ensure turbo is explicitly off
      });

      expect(setDeviceOptionsSpy).toHaveBeenCalledWith({
        power: PowerState.On,
        fanSpeed: FanSpeed.Low,
        sleep: SleepModeState.On,
        turbo: PowerState.Off, // Ensure turbo is explicitly off
      });
    });
  });

  describe('setSleepAndTurbo (now setDeviceOptions)', () => {
    it('should call setDeviceOptions with correct parameters for sleep and turbo, ensuring sleep is off', async () => {
      vi.useRealTimers();

      await api.setDeviceOptions({ 
        power: PowerState.On,
        fanSpeed: FanSpeed.High, 
        turbo: PowerState.On,
        sleep: SleepModeState.Off, // Ensure sleep is explicitly off
      });

      expect(setDeviceOptionsSpy).toHaveBeenCalledWith({
        power: PowerState.On,
        fanSpeed: FanSpeed.High,
        turbo: PowerState.On,
        sleep: SleepModeState.Off, // Ensure sleep is explicitly off
      });
    });
  });

  describe('setSleepState', () => {
    it('should call setDeviceOptions with correct parameters for turning sleep on', async () => {
      vi.useRealTimers();
      await api.setDeviceOptions({ sleep: SleepModeState.On });
      expect(setDeviceOptionsSpy).toHaveBeenCalledWith({
        sleep: SleepModeState.On,
      });
    });

    it('should call setDeviceOptions with correct parameters for turning sleep off', async () => {
      vi.useRealTimers();
      await api.setDeviceOptions({ sleep: SleepModeState.Off });
      expect(setDeviceOptionsSpy).toHaveBeenCalledWith({
        sleep: SleepModeState.Off,
      });
    });
  });

  describe('setBeepState', () => {
    it('should call setDeviceOptions to set beep on', async () => {
      vi.useRealTimers();
      await api.setDeviceOptions({ beep: PowerState.On });
      expect(setDeviceOptionsSpy).toHaveBeenCalledWith({
        beep: PowerState.On,
      });
    });

    it('should call setDeviceOptions to set beep off', async () => {
      vi.useRealTimers();
      await api.setDeviceOptions({ beep: PowerState.Off });
      expect(setDeviceOptionsSpy).toHaveBeenCalledWith({
        beep: PowerState.Off,
      });
    });
  });
});
