// AirConditionerAPI.temperature.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AirConditionerAPI } from '../AirConditionerAPI.js';
import { TfiacDeviceConfig } from '../settings.js';
import { PowerState, OperationMode, FanSpeed, SwingMode, SleepModeState } from '../enums.js';

describe('AirConditionerAPI Temperature Conversion', () => {
  let api: AirConditionerAPI;
  let mockSendCommand: any;
  let mockSendQuestCommand: any;

  beforeEach(() => {
    // Mock the sendCommand and sendQuestCommand methods to avoid actual network calls
    mockSendCommand = vi.fn().mockResolvedValue('OK');
    mockSendQuestCommand = vi.fn().mockResolvedValue('<Response><TurnOn>1</TurnOn><SetTemp>24</SetTemp><BaseMode>1</BaseMode><WindSpeed>0</WindSpeed><WindDirection_H>0</WindDirection_H><WindDirection_V>0</WindDirection_V></Response>');
  });

  describe('useFahrenheit = false (explicitly disabled)', () => {
    beforeEach(() => {
      const config: TfiacDeviceConfig = {
        name: 'Test AC',
        ip: '192.168.1.100',
        useFahrenheit: false
      };
      api = new AirConditionerAPI('192.168.1.100', 7777, 3, 1000, config);
      
      // Mock the private methods
      (api as any).sendCommandWithRetry = mockSendCommand;
      (api as any).sendQuestCommand = mockSendQuestCommand;
    });

    it('should not convert temperature when useFahrenheit is explicitly false', async () => {
      // Set initial status to avoid null checks
      (api as any).lastStatus = {
        is_on: PowerState.Off,
        operation_mode: OperationMode.Auto,
        target_temp: 20,
        current_temp: 20,
        fan_mode: FanSpeed.Auto,
        swing_mode: SwingMode.Off
      };

      await api.setDeviceOptions({ 
        power: PowerState.On,
        mode: OperationMode.Cool,
        temp: 22 // 22°C should remain 22°C
      });

      // Verify that sendCommand was called
      expect(mockSendCommand).toHaveBeenCalled();
      
      // Get the command that was sent
      const commandCall = mockSendCommand.mock.calls[0];
      const command = commandCall[0];
      
      // The command should contain the original temperature (22)
      expect(command).toContain('<SetTemp>22</SetTemp>');
    });
  });

  describe('useFahrenheit = true (default/explicit)', () => {
    beforeEach(() => {
      const config: TfiacDeviceConfig = {
        name: 'Test AC',
        ip: '192.168.1.100',
        useFahrenheit: true
      };
      api = new AirConditionerAPI('192.168.1.100', 7777, 3, 1000, config);
      
      // Mock the private methods
      (api as any).sendCommandWithRetry = mockSendCommand;
      (api as any).sendQuestCommand = mockSendQuestCommand;
    });

    it('should convert temperature from Celsius to Fahrenheit when useFahrenheit is true', async () => {
      // Set initial status to avoid null checks
      (api as any).lastStatus = {
        is_on: PowerState.Off,
        operation_mode: OperationMode.Auto,
        target_temp: 20,
        current_temp: 20,
        fan_mode: FanSpeed.Auto,
        swing_mode: SwingMode.Off
      };

      await api.setDeviceOptions({ 
        power: PowerState.On,
        mode: OperationMode.Cool,
        temp: 22 // 22°C should be converted to 72°F
      });

      // Verify that sendCommand was called
      expect(mockSendCommand).toHaveBeenCalled();
      
      // Get the command that was sent
      const commandCall = mockSendCommand.mock.calls[0];
      const command = commandCall[0];
      
      // 22°C = (22 * 9/5) + 32 = 39.6 + 32 = 71.6°F, rounded to 72°F
      expect(command).toContain('<SetTemp>72</SetTemp>');
    });

    it('should convert different temperatures correctly', async () => {
      // Set initial status to avoid null checks
      (api as any).lastStatus = {
        is_on: PowerState.Off,
        operation_mode: OperationMode.Auto,
        target_temp: 20,
        current_temp: 20,
        fan_mode: FanSpeed.Auto,
        swing_mode: SwingMode.Off
      };

      // Test multiple temperature conversions
      const testCases = [
        { celsius: 20, expectedFahrenheit: 68 }, // 20°C = 68°F
        { celsius: 25, expectedFahrenheit: 77 }, // 25°C = 77°F  
        { celsius: 18, expectedFahrenheit: 64 }, // 18°C = 64.4°F ≈ 64°F
        { celsius: 30, expectedFahrenheit: 86 }  // 30°C = 86°F
      ];

      for (const testCase of testCases) {
        mockSendCommand.mockClear();
        
        await api.setDeviceOptions({ 
          power: PowerState.On,
          mode: OperationMode.Cool,
          temp: testCase.celsius
        });

        expect(mockSendCommand).toHaveBeenCalled();
        const commandCall = mockSendCommand.mock.calls[0];
        const command = commandCall[0];
        
        expect(command).toContain(`<SetTemp>${testCase.expectedFahrenheit}</SetTemp>`);
      }
    });

    it('should use default temperature when temp is not provided', async () => {
      // Set initial status to avoid null checks
      (api as any).lastStatus = {
        is_on: PowerState.Off,
        operation_mode: OperationMode.Auto,
        target_temp: 24, // Default is 24°C
        current_temp: 20,
        fan_mode: FanSpeed.Auto,
        swing_mode: SwingMode.Off
      };

      await api.setDeviceOptions({ 
        power: PowerState.On,
        mode: OperationMode.Cool
        // temp not provided, should use current.target_temp (24°C)
      });

      expect(mockSendCommand).toHaveBeenCalled();
      const commandCall = mockSendCommand.mock.calls[0];
      const command = commandCall[0];
      
      // 24°C = (24 * 9/5) + 32 = 43.2 + 32 = 75.2°F ≈ 75°F
      expect(command).toContain('<SetTemp>75</SetTemp>');
    });
  });

  describe('useFahrenheit undefined (defaults to true)', () => {
    beforeEach(() => {
      const config: TfiacDeviceConfig = {
        name: 'Test AC',
        ip: '192.168.1.100'
        // useFahrenheit not specified, should default to true
      };
      api = new AirConditionerAPI('192.168.1.100', 7777, 3, 1000, config);
      
      // Mock the private methods
      (api as any).sendCommandWithRetry = mockSendCommand;
      (api as any).sendQuestCommand = mockSendQuestCommand;
    });

    it('should convert temperature when useFahrenheit is undefined (defaults to true)', async () => {
      // Set initial status to avoid null checks
      (api as any).lastStatus = {
        is_on: PowerState.Off,
        operation_mode: OperationMode.Auto,
        target_temp: 20,
        current_temp: 20,
        fan_mode: FanSpeed.Auto,
        swing_mode: SwingMode.Off
      };

      await api.setDeviceOptions({ 
        power: PowerState.On,
        mode: OperationMode.Cool,
        temp: 25 // 25°C should be converted to 77°F
      });

      expect(mockSendCommand).toHaveBeenCalled();
      const commandCall = mockSendCommand.mock.calls[0];
      const command = commandCall[0];
      
      // 25°C = (25 * 9/5) + 32 = 45 + 32 = 77°F
      expect(command).toContain('<SetTemp>77</SetTemp>');
    });
  });

  describe('no device config provided (defaults to Fahrenheit)', () => {
    beforeEach(() => {
      // Create API without device config (should default to Fahrenheit)
      api = new AirConditionerAPI('192.168.1.100', 7777, 3, 1000);
      
      // Mock the private methods
      (api as any).sendCommandWithRetry = mockSendCommand;
      (api as any).sendQuestCommand = mockSendQuestCommand;
    });

    it('should convert temperature when no device config is provided (defaults to Fahrenheit)', async () => {
      // Set initial status to avoid null checks
      (api as any).lastStatus = {
        is_on: PowerState.Off,
        operation_mode: OperationMode.Auto,
        target_temp: 20,
        current_temp: 20,
        fan_mode: FanSpeed.Auto,
        swing_mode: SwingMode.Off
      };

      await api.setDeviceOptions({ 
        power: PowerState.On,
        mode: OperationMode.Cool,
        temp: 22 // 22°C should be converted to 72°F by default
      });

      expect(mockSendCommand).toHaveBeenCalled();
      const commandCall = mockSendCommand.mock.calls[0];
      const command = commandCall[0];
      
      // The command should contain the converted temperature (72°F)
      expect(command).toContain('<SetTemp>72</SetTemp>');
    });
  });
});
