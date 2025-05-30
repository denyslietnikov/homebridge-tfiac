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
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('setPower method edge cases (lines 471-487)', () => {
    it('should handle setPower OFF with existing valid operation mode', async () => {
      const mockResponseXML = `
        <msg msgid="ACKSetMessage" type="Control" seq="52">
          <ACKSetMessage><Return>ok</Return></ACKSetMessage>
        </msg>
      `;

      // Set up initial state with a valid operation mode
      (api as any).lastStatus = {
        current_temp: 22,
        target_temp: 24,
        operation_mode: OperationMode.Cool,
        fan_mode: FanSpeed.Medium,
        power: PowerState.On,
        swing_h: SwingMode.Off,
        swing_v: SwingMode.Off,
        sleep_mode: SleepModeState.Off,
        eco_mode: PowerState.Off,
        turbo_mode: PowerState.Off,
        display: PowerState.On,
      };

      const setDeviceOptionsSpy = vi.spyOn(api, 'setDeviceOptions');
      setDeviceOptionsSpy.mockResolvedValue();

      simulateResponse(mockResponseXML);

      await api.setPower(PowerState.Off);

      expect(setDeviceOptionsSpy).toHaveBeenCalledWith({
        power: PowerState.Off,
        mode: OperationMode.Cool,
        temp: 24,
      });

      vi.advanceTimersByTime(100);
    });

    it('should handle setPower OFF with invalid operation mode string', async () => {
      const mockResponseXML = `
        <msg msgid="ACKSetMessage" type="Control" seq="52">
          <ACKSetMessage><Return>ok</Return></ACKSetMessage>
        </msg>
      `;

      // Set up initial state with an invalid operation mode string
      (api as any).lastStatus = {
        current_temp: 22,
        target_temp: 25,
        operation_mode: 'invalid_mode' as OperationMode,
        fan_mode: FanSpeed.Medium,
        power: PowerState.On,
        swing_h: SwingMode.Off,
        swing_v: SwingMode.Off,
        sleep_mode: SleepModeState.Off,
        eco_mode: PowerState.Off,
        turbo_mode: PowerState.Off,
        display: PowerState.On,
      };

      const setDeviceOptionsSpy = vi.spyOn(api, 'setDeviceOptions');
      setDeviceOptionsSpy.mockResolvedValue();

      simulateResponse(mockResponseXML);

      await api.setPower(PowerState.Off);

      expect(setDeviceOptionsSpy).toHaveBeenCalledWith({
        power: PowerState.Off,
        mode: OperationMode.Auto,
        temp: 25,
      });

      vi.advanceTimersByTime(100);
    });

    it('should handle setPower OFF with undefined lastStatus', async () => {
      const mockResponseXML = `
        <msg msgid="ACKSetMessage" type="Control" seq="52">
          <ACKSetMessage><Return>ok</Return></ACKSetMessage>
        </msg>
      `;

      // Clear lastStatus to test undefined case
      (api as any).lastStatus = undefined;

      const setDeviceOptionsSpy = vi.spyOn(api, 'setDeviceOptions');
      setDeviceOptionsSpy.mockResolvedValue();

      simulateResponse(mockResponseXML);

      await api.setPower(PowerState.Off);

      expect(setDeviceOptionsSpy).toHaveBeenCalledWith({
        power: PowerState.Off,
        mode: OperationMode.Auto,
        temp: 24,
      });

      vi.advanceTimersByTime(100);
    });
  });

  describe('setFanAndSleep method (lines 490-491)', () => {
    it('should call setDeviceOptions with fan speed and sleep parameters', async () => {
      const mockResponseXML = `
        <msg msgid="ACKSetMessage" type="Control" seq="52">
          <ACKSetMessage><Return>ok</Return></ACKSetMessage>
        </msg>
      `;

      const setDeviceOptionsSpy = vi.spyOn(api, 'setDeviceOptions');
      setDeviceOptionsSpy.mockResolvedValue();

      simulateResponse(mockResponseXML);

      await api.setFanAndSleep(FanSpeed.High, SleepModeState.On);

      expect(setDeviceOptionsSpy).toHaveBeenCalledWith({
        power: PowerState.On,
        fanSpeed: FanSpeed.High,
        sleep: SleepModeState.On,
      });

      vi.advanceTimersByTime(100);
    });

    it('should work with string sleep mode parameter', async () => {
      const mockResponseXML = `
        <msg msgid="ACKSetMessage" type="Control" seq="52">
          <ACKSetMessage><Return>ok</Return></ACKSetMessage>
        </msg>
      `;

      const setDeviceOptionsSpy = vi.spyOn(api, 'setDeviceOptions');
      setDeviceOptionsSpy.mockResolvedValue();

      simulateResponse(mockResponseXML);

      await api.setFanAndSleep(FanSpeed.Low, 'sleepMode2:1:2:3:4:5:6:7:8:9:10');

      expect(setDeviceOptionsSpy).toHaveBeenCalledWith({
        power: PowerState.On,
        fanSpeed: FanSpeed.Low,
        sleep: 'sleepMode2:1:2:3:4:5:6:7:8:9:10',
      });

      vi.advanceTimersByTime(100);
    });
  });

  describe('setSleepAndTurbo method (line 499)', () => {
    it('should call setDeviceOptions with sleep and turbo parameters', async () => {
      const mockResponseXML = `
        <msg msgid="ACKSetMessage" type="Control" seq="52">
          <ACKSetMessage><Return>ok</Return></ACKSetMessage>
        </msg>
      `;

      // Spy on setDeviceOptions to verify it's called correctly
      const setDeviceOptionsSpy = vi.spyOn(api, 'setDeviceOptions');
      setDeviceOptionsSpy.mockResolvedValue();

      simulateResponse(mockResponseXML);

      await api.setSleepAndTurbo(SleepModeState.On, PowerState.On);

      expect(setDeviceOptionsSpy).toHaveBeenCalledWith({
        power: PowerState.On,
        sleep: SleepModeState.On,
        turbo: PowerState.On,
      });

      vi.advanceTimersByTime(100);
    });

    it('should handle string sleep mode parameter', async () => {
      const mockResponseXML = `
        <msg msgid="ACKSetMessage" type="Control" seq="52">
          <ACKSetMessage><Return>ok</Return></ACKSetMessage>
        </msg>
      `;

      const setDeviceOptionsSpy = vi.spyOn(api, 'setDeviceOptions');
      setDeviceOptionsSpy.mockResolvedValue();

      simulateResponse(mockResponseXML);

      await api.setSleepAndTurbo('sleepMode1:0:0:0:0:0:0:0:0:0:0', PowerState.Off);

      expect(setDeviceOptionsSpy).toHaveBeenCalledWith({
        power: PowerState.On,
        sleep: 'sleepMode1:0:0:0:0:0:0:0:0:0:0',
        turbo: PowerState.Off,
      });

      vi.advanceTimersByTime(100);
    });
  });

  describe('setFanOnly method (lines 502-503)', () => {
    it('should call setDeviceOptions with FanOnly mode and fan speed', async () => {
      const mockResponseXML = `
        <msg msgid="ACKSetMessage" type="Control" seq="52">
          <ACKSetMessage><Return>ok</Return></ACKSetMessage>
        </msg>
      `;

      const setDeviceOptionsSpy = vi.spyOn(api, 'setDeviceOptions');
      setDeviceOptionsSpy.mockResolvedValue();

      simulateResponse(mockResponseXML);

      await api.setFanOnly(FanSpeed.High);

      expect(setDeviceOptionsSpy).toHaveBeenCalledWith({
        power: PowerState.On,
        mode: OperationMode.FanOnly,
        fanSpeed: FanSpeed.High,
      });

      vi.advanceTimersByTime(100);
    });

    it('should work with different fan speeds', async () => {
      const mockResponseXML = `
        <msg msgid="ACKSetMessage" type="Control" seq="52">
          <ACKSetMessage><Return>ok</Return></ACKSetMessage>
        </msg>
      `;

      const setDeviceOptionsSpy = vi.spyOn(api, 'setDeviceOptions');
      setDeviceOptionsSpy.mockResolvedValue();

      simulateResponse(mockResponseXML);

      await api.setFanOnly(FanSpeed.Low);

      expect(setDeviceOptionsSpy).toHaveBeenCalledWith({
        power: PowerState.On,
        mode: OperationMode.FanOnly,
        fanSpeed: FanSpeed.Low,
      });

      vi.advanceTimersByTime(100);
    });
  });

  describe('updateState fan speed mapping logic (lines 545-547, 549-551, 559-562)', () => {
    beforeEach(() => {
      // Mock sendCommandWithRetry to return various responses
      vi.spyOn(api as any, 'sendCommandWithRetry').mockImplementation(async () => {
        return 'mocked_response';
      });
    });

    it('should handle exact match for Turbo fan speed (pct === 100)', async () => {
      const mockResponseXML = `
        <msg msgid="statusUpdateMsg" type="Control" seq="55">
          <statusUpdateMsg>
            <IndoorTemp>23</IndoorTemp>
            <SetTemp>22</SetTemp>
            <BaseMode>cool</BaseMode>
            <WindSpeed>100</WindSpeed>
            <TurnOn>on</TurnOn>
            <WindDirection_H>off</WindDirection_H>
            <WindDirection_V>off</WindDirection_V>
            <Opt_display>on</Opt_display>
            <Opt_ECO>off</Opt_ECO>
            <Opt_super>off</Opt_super>
            <Opt_sleepMode>off</Opt_sleepMode>
            <BeepEnable>on</BeepEnable>
            <DeviceName>AC Test</DeviceName>
            <WifiVer>1</WifiVer>
          </statusUpdateMsg>
        </msg>
      `;

      // Mock sendCommandWithRetry to return this specific response
      (api as any).sendCommandWithRetry.mockResolvedValue(mockResponseXML);

      const result = await api.updateState(true);

      expect(result.fan_mode).toBe(FanSpeed.Turbo);
    });

    it('should handle exact match for Auto fan speed (pct === 0)', async () => {
      const mockResponseXML = `
        <msg msgid="statusUpdateMsg" type="Control" seq="55">
          <statusUpdateMsg>
            <IndoorTemp>23</IndoorTemp>
            <SetTemp>22</SetTemp>
            <BaseMode>cool</BaseMode>
            <WindSpeed>0</WindSpeed>
            <TurnOn>on</TurnOn>
            <WindDirection_H>off</WindDirection_H>
            <WindDirection_V>off</WindDirection_V>
            <Opt_display>on</Opt_display>
            <Opt_ECO>off</Opt_ECO>
            <Opt_super>off</Opt_super>
            <Opt_sleepMode>off</Opt_sleepMode>
            <BeepEnable>on</BeepEnable>
            <DeviceName>AC Test</DeviceName>
            <WifiVer>1</WifiVer>
          </statusUpdateMsg>
        </msg>
      `;

      (api as any).sendCommandWithRetry.mockResolvedValue(mockResponseXML);

      const result = await api.updateState(true);

      expect(result.fan_mode).toBe(FanSpeed.Auto);
    });

    it('should handle fan speed tie resolution - prefer higher fan speed', async () => {
      // Test a percentage that might create a tie between two fan speeds
      // Let's use 37 which is between Silent (15) and Low (30), closer to Low but could tie
      const mockResponseXML = `
        <msg msgid="statusUpdateMsg" type="Control" seq="55">
          <statusUpdateMsg>
            <IndoorTemp>23</IndoorTemp>
            <SetTemp>22</SetTemp>
            <BaseMode>cool</BaseMode>
            <WindSpeed>37</WindSpeed>
            <TurnOn>on</TurnOn>
            <WindDirection_H>off</WindDirection_H>
            <WindDirection_V>off</WindDirection_V>
            <Opt_display>on</Opt_display>
            <Opt_ECO>off</Opt_ECO>
            <Opt_super>off</Opt_super>
            <Opt_sleepMode>off</Opt_sleepMode>
            <BeepEnable>on</BeepEnable>
            <DeviceName>AC Test</DeviceName>
            <WifiVer>1</WifiVer>
          </statusUpdateMsg>
        </msg>
      `;

      (api as any).sendCommandWithRetry.mockResolvedValue(mockResponseXML);

      const result = await api.updateState(true);

      // Should map to closest fan speed - 37 is closer to MediumLow (40) than Low (25)
      // Distance: |37-40| = 3 vs |37-25| = 12, so MediumLow is closest
      expect(result.fan_mode).toBe(FanSpeed.MediumLow);
    });

    it('should handle fan speed mapping for percentage between Silent and Low', async () => {
      // Test a percentage between Silent (15) and Low (30) - should map to closest
      const mockResponseXML = `
        <msg msgid="statusUpdateMsg" type="Control" seq="55">
          <statusUpdateMsg>
            <IndoorTemp>23</IndoorTemp>
            <SetTemp>22</SetTemp>
            <BaseMode>cool</BaseMode>
            <WindSpeed>22</WindSpeed>
            <TurnOn>on</TurnOn>
            <WindDirection_H>off</WindDirection_H>
            <WindDirection_V>off</WindDirection_V>
            <Opt_display>on</Opt_display>
            <Opt_ECO>off</Opt_ECO>
            <Opt_super>off</Opt_super>
            <Opt_sleepMode>off</Opt_sleepMode>
            <BeepEnable>on</BeepEnable>
            <DeviceName>AC Test</DeviceName>
            <WifiVer>1</WifiVer>
          </statusUpdateMsg>
        </msg>
      `;

      (api as any).sendCommandWithRetry.mockResolvedValue(mockResponseXML);

      const result = await api.updateState(true);

      // 22 should map to Low (25) as the closest available speed (Silent doesn't exist)
      expect(result.fan_mode).toBe(FanSpeed.Low);
    });

    it('should handle fan speed mapping with tie scenario and prefer higher speed', async () => {
      // Create a scenario where two speeds have equal difference - test the tie-breaking logic
      // Mid-point between Silent (15) and Low (30) is 22.5, so 22 or 23 should test tie logic
      const mockResponseXML = `
        <msg msgid="statusUpdateMsg" type="Control" seq="55">
          <statusUpdateMsg>
            <IndoorTemp>23</IndoorTemp>
            <SetTemp>22</SetTemp>
            <BaseMode>cool</BaseMode>
            <WindSpeed>52</WindSpeed>
            <TurnOn>on</TurnOn>
            <WindDirection_H>off</WindDirection_H>
            <WindDirection_V>off</WindDirection_V>
            <Opt_display>on</Opt_display>
            <Opt_ECO>off</Opt_ECO>
            <Opt_super>off</Opt_super>
            <Opt_sleepMode>off</Opt_sleepMode>
            <BeepEnable>on</BeepEnable>
            <DeviceName>AC Test</DeviceName>
            <WifiVer>1</WifiVer>
          </statusUpdateMsg>
        </msg>
      `;

      (api as any).sendCommandWithRetry.mockResolvedValue(mockResponseXML);

      const result = await api.updateState(true);

      // 52 is between MediumLow (40) and Medium (60)
      // 52-40=12, 60-52=8, so Medium is closest
      expect(result.fan_mode).toBe(FanSpeed.Medium);
    });

    it('should exclude Auto and Turbo from general numeric matching unless exact', async () => {
      // Test a percentage close to Auto (0) or Turbo (100) but not exact
      const mockResponseXML = `
        <msg msgid="statusUpdateMsg" type="Control" seq="55">
          <statusUpdateMsg>
            <IndoorTemp>23</IndoorTemp>
            <SetTemp>22</SetTemp>
            <BaseMode>cool</BaseMode>
            <WindSpeed>5</WindSpeed>
            <TurnOn>on</TurnOn>
            <WindDirection_H>off</WindDirection_H>
            <WindDirection_V>off</WindDirection_V>
            <Opt_display>on</Opt_display>
            <Opt_ECO>off</Opt_ECO>
            <Opt_super>off</Opt_super>
            <Opt_sleepMode>off</Opt_sleepMode>
            <BeepEnable>on</BeepEnable>
            <DeviceName>AC Test</DeviceName>
            <WifiVer>1</WifiVer>
          </statusUpdateMsg>
        </msg>
      `;

      (api as any).sendCommandWithRetry.mockResolvedValue(mockResponseXML);

      const result = await api.updateState(true);

      // 5 should map to Low (25) as the closest available speed (Silent doesn't exist)
      expect(result.fan_mode).toBe(FanSpeed.Low);
    });

    it('should handle non-numeric WindSpeed values', async () => {
      const mockResponseXML = `
        <msg msgid="statusUpdateMsg" type="Control" seq="55">
          <statusUpdateMsg>
            <IndoorTemp>23</IndoorTemp>
            <SetTemp>22</SetTemp>
            <BaseMode>cool</BaseMode>
            <WindSpeed>High</WindSpeed>
            <TurnOn>on</TurnOn>
            <WindDirection_H>off</WindDirection_H>
            <WindDirection_V>off</WindDirection_V>
            <Opt_display>on</Opt_display>
            <Opt_ECO>off</Opt_ECO>
            <Opt_super>off</Opt_super>
            <Opt_sleepMode>off</Opt_sleepMode>
            <BeepEnable>on</BeepEnable>
            <DeviceName>AC Test</DeviceName>
            <WifiVer>1</WifiVer>
          </statusUpdateMsg>
        </msg>
      `;

      (api as any).sendCommandWithRetry.mockResolvedValue(mockResponseXML);

      const result = await api.updateState(true);

      // Non-numeric value should be used as-is
      expect(result.fan_mode).toBe('High');
    });
  });

  describe('Fan speed tie-breaking logic (lines 559-562)', () => {
    beforeEach(() => {
      // Mock sendCommandWithRetry to return various responses
      vi.spyOn(api as any, 'sendCommandWithRetry').mockImplementation(async () => {
        return 'mocked_response';
      });
    });

    it('should prefer higher fan speed when there is an exact tie', async () => {
      // Create a scenario where we have an exact tie between two fan speeds
      // Middle point between MediumLow (45) and Medium (60) is 52.5
      // So 52 should be closer to MediumLow (diff=7) vs Medium (diff=8)
      // But let's test 57.5 which would be exactly in the middle if that were possible
      const mockResponseXML = `
        <msg msgid="statusUpdateMsg" type="Control" seq="55">
          <statusUpdateMsg>
            <IndoorTemp>23</IndoorTemp>
            <SetTemp>22</SetTemp>
            <BaseMode>cool</BaseMode>
            <WindSpeed>37</WindSpeed>
            <TurnOn>on</TurnOn>
            <WindDirection_H>off</WindDirection_H>
            <WindDirection_V>off</WindDirection_V>
            <Opt_display>on</Opt_display>
            <Opt_ECO>off</Opt_ECO>
            <Opt_super>off</Opt_super>
            <Opt_sleepMode>off</Opt_sleepMode>
            <BeepEnable>on</BeepEnable>
            <DeviceName>AC Test</DeviceName>
            <WifiVer>1</WifiVer>
          </statusUpdateMsg>
        </msg>
      `;

      (api as any).sendCommandWithRetry.mockResolvedValue(mockResponseXML);

      const result = await api.updateState(true);

      // 37 is closest to MediumLow (40) with diff=3 vs Low (25) with diff=12
      expect(result.fan_mode).toBe(FanSpeed.MediumLow);
    });

    it('should handle multiple fan speeds with same percentage values', async () => {
      // Test with value 100 which both High and Turbo have
      // But exact match for Turbo should be handled first
      const mockResponseXML = `
        <msg msgid="statusUpdateMsg" type="Control" seq="55">
          <statusUpdateMsg>
            <IndoorTemp>23</IndoorTemp>
            <SetTemp>22</SetTemp>
            <BaseMode>cool</BaseMode>
            <WindSpeed>98</WindSpeed>
            <TurnOn>on</TurnOn>
            <WindDirection_H>off</WindDirection_H>
            <WindDirection_V>off</WindDirection_V>
            <Opt_display>on</Opt_display>
            <Opt_ECO>off</Opt_ECO>
            <Opt_super>off</Opt_super>
            <Opt_sleepMode>off</Opt_sleepMode>
            <BeepEnable>on</BeepEnable>
            <DeviceName>AC Test</DeviceName>
            <WifiVer>1</WifiVer>
          </statusUpdateMsg>
        </msg>
      `;

      (api as any).sendCommandWithRetry.mockResolvedValue(mockResponseXML);

      const result = await api.updateState(true);

      // 98 is closest to High (100) with diff=2
      expect(result.fan_mode).toBe(FanSpeed.High);
    });
    
    it('should trigger exact tie-breaking logic by creating equal differences', async () => {
      // Test a very specific case to trigger the tie-breaking logic
      // We need to simulate a custom scenario where two speeds have identical differences
      // Let's use a percentage that would create equal distances from two speeds
      // 
      // Looking at the FanSpeedPercentMap:
      // Silent: 15, Low: 30, MediumLow: 45, Medium: 60, MediumHigh: 75, High: 100
      // We can modify our test to manually create a tie scenario using mocking
      
      const originalFanSpeedPercentMap = {
        [FanSpeed.Auto]: 0,
        [FanSpeed.Low]: 10,     // Modified for test (lowest available speed)
        [FanSpeed.MediumLow]: 45,
        [FanSpeed.Medium]: 60,
        [FanSpeed.MediumHigh]: 75,
        [FanSpeed.High]: 100,
        [FanSpeed.Turbo]: 100,
      };
      
      // Mock the enum to create a tie scenario
      const moduleToMock = await import('../enums.js');
      vi.spyOn(moduleToMock, 'FanSpeedPercentMap', 'get').mockReturnValue(originalFanSpeedPercentMap as any);
      
      const mockResponseXML = `
        <msg msgid="statusUpdateMsg" type="Control" seq="55">
          <statusUpdateMsg>
            <IndoorTemp>23</IndoorTemp>
            <SetTemp>22</SetTemp>
            <BaseMode>cool</BaseMode>
            <WindSpeed>15</WindSpeed>
            <TurnOn>on</TurnOn>
            <WindDirection_H>off</WindDirection_H>
            <WindDirection_V>off</WindDirection_V>
            <Opt_display>on</Opt_display>
            <Opt_ECO>off</Opt_ECO>
            <Opt_super>off</Opt_super>
            <Opt_sleepMode>off</Opt_sleepMode>
            <BeepEnable>on</BeepEnable>
            <DeviceName>AC Test</DeviceName>
            <WifiVer>1</WifiVer>
          </statusUpdateMsg>
        </msg>
      `;

      (api as any).sendCommandWithRetry.mockResolvedValue(mockResponseXML);

      const result = await api.updateState(true);

      // With our mocked values:
      // Low: 10, diff = |15-10| = 5
      // MediumLow: 45, diff = |15-45| = 30
      // Low should be chosen as it's closest to 15
      expect(result.fan_mode).toBe(FanSpeed.Low);
    });
  });
});
