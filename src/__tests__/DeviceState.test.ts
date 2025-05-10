// filepath: src/__tests__/DeviceState.test.ts
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { DeviceState } from '../state/DeviceState.js';
import { 
  PowerState, 
  OperationMode, 
  FanSpeed, 
  SwingMode, 
  SleepModeState 
} from '../enums.js';

describe('DeviceState', () => {
  let state: DeviceState;

  beforeEach(() => {
    state = new DeviceState();
  });

  it('should initialize with default values', () => {
    expect(state.power).toBe(PowerState.Off);
    expect(state.operationMode).toBe(OperationMode.Auto);
    expect(state.fanSpeed).toBe(FanSpeed.Auto);
  });

  it('should update from device status', () => {
    const status = {
      is_on: 'on',
      operation_mode: OperationMode.Cool,
      target_temp: 22,
      current_temp: 24,
      fan_mode: FanSpeed.High,
      swing_mode: SwingMode.Vertical,
      opt_turbo: PowerState.Off,
      opt_sleepMode: SleepModeState.Off,
    };

    const changed = state.updateFromDevice(status);
    
    expect(changed).toBe(true);
    expect(state.power).toBe(PowerState.On);
    expect(state.operationMode).toBe(OperationMode.Cool);
    expect(state.targetTemperature).toBe(22);
    expect(state.currentTemperature).toBe(24);
    expect(state.fanSpeed).toBe(FanSpeed.High);
    expect(state.swingMode).toBe(SwingMode.Vertical);
    expect(state.turboMode).toBe(PowerState.Off);
    expect(state.sleepMode).toBe(SleepModeState.Off);
  });

  it('should not trigger change event if values are the same', () => {
    // First update
    state.updateFromDevice({
      is_on: 'on',
      operation_mode: OperationMode.Cool,
      target_temp: 22,
      current_temp: 20, 
      fan_mode: FanSpeed.Auto,
      swing_mode: SwingMode.Off
    });
    
    // Add event listener
    let eventTriggered = false;
    state.on('stateChanged', () => {
      eventTriggered = true;
    });
    
    // Update with same values
    const changed = state.updateFromDevice({
      is_on: 'on',
      operation_mode: OperationMode.Cool,
      target_temp: 22,
      current_temp: 20,
      fan_mode: FanSpeed.Auto,
      swing_mode: SwingMode.Off
    });
    
    expect(changed).toBe(false);
    expect(eventTriggered).toBe(false);
  });

  it('should convert to API status object', () => {
    state.setPower(PowerState.On);
    state.setOperationMode(OperationMode.Cool);
    state.setTargetTemperature(23);
    state.setFanSpeed(FanSpeed.High);
    
    const apiStatus = state.toApiStatus();
    
    expect(apiStatus.is_on).toBe(PowerState.On);
    expect(apiStatus.operation_mode).toBe(OperationMode.Cool);
    expect(apiStatus.target_temp).toBe(23);
    expect(apiStatus.fan_mode).toBe(FanSpeed.High);
  });

  it('should turn off turbo mode when sleep mode is enabled', () => {
    state.setPower(PowerState.On);
    state.setTurboMode(PowerState.On);
    
    expect(state.turboMode).toBe(PowerState.On);
    expect(state.fanSpeed).toBe(FanSpeed.Turbo);
    
    state.setSleepMode(SleepModeState.On);
    
    expect(state.sleepMode).toBe(SleepModeState.On);
    expect(state.turboMode).toBe(PowerState.Off);
    expect(state.fanSpeed).toBe(FanSpeed.Low);
  });

  it('should turn off sleep mode when turbo mode is enabled', () => {
    state.setPower(PowerState.On);
    state.setSleepMode(SleepModeState.On);
    
    expect(state.sleepMode).toBe(SleepModeState.On);
    expect(state.fanSpeed).toBe(FanSpeed.Low);
    
    state.setTurboMode(PowerState.On);
    
    expect(state.turboMode).toBe(PowerState.On);
    expect(state.sleepMode).toBe(SleepModeState.Off);
    expect(state.fanSpeed).toBe(FanSpeed.Turbo);
  });

  it('should reset conditional modes when power is turned off', () => {
    state.setPower(PowerState.On);
    state.setTurboMode(PowerState.On);
    state.setSleepMode(SleepModeState.On); // This would normally turn off turbo, but we're testing the power off reset
    
    state.setPower(PowerState.Off);
    
    expect(state.power).toBe(PowerState.Off);
    expect(state.turboMode).toBe(PowerState.Off);
    expect(state.sleepMode).toBe(SleepModeState.Off);
    // Operation mode should be preserved for next power on
    expect(state.operationMode).toBe(OperationMode.Auto);
  });

  it('should adjust fan speed when operation mode is set to Dry', () => {
    state.setPower(PowerState.On);
    state.setFanSpeed(FanSpeed.High);
    
    state.setOperationMode(OperationMode.Dry);
    
    expect(state.operationMode).toBe(OperationMode.Dry);
    expect(state.fanSpeed).toBe(FanSpeed.Low);
    expect(state.turboMode).toBe(PowerState.Off);
  });

  it('should set fan speed to Auto when operation mode is set to Auto', () => {
    state.setPower(PowerState.On);
    state.setFanSpeed(FanSpeed.High);
    
    state.setOperationMode(OperationMode.Auto);
    
    expect(state.operationMode).toBe(OperationMode.Auto);
    expect(state.fanSpeed).toBe(FanSpeed.Auto);
  });
});
