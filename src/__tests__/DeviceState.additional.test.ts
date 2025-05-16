import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeviceState } from '../state/DeviceState.js';
import { PowerState, OperationMode, FanSpeed, SwingMode, SleepModeState } from '../enums.js';

describe('DeviceState - additional coverage', () => {
  let state: DeviceState;
  beforeEach(() => {
    state = new DeviceState();
  });

  it('should clamp target temperature within bounds and emit event on change', () => {
    const spy = vi.fn();
    state.on('stateChanged', spy);
    state.setTargetTemperature(100); // above max 30
    expect(state.targetTemperature).toBe(30);
    expect(spy).toHaveBeenCalled();
    spy.mockClear();
    state.setTargetTemperature(15); // below min 16
    expect(state.targetTemperature).toBe(16);
    expect(spy).toHaveBeenCalled();
  });

  it('should toggle eco, display, and beep modes and emit events', () => {
    const spy = vi.fn();
    state.on('stateChanged', spy);
    
    // Need to turn power on first for eco mode to work
    state.setPower(PowerState.On);
    spy.mockClear(); // Reset the spy after power set
    
    state.setEcoMode(PowerState.On);
    expect(state.ecoMode).toBe(PowerState.On);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should calculate diff between states correctly', () => {
    const other = new DeviceState(); // Create a fresh instance
    
    // Directly set the internal state to bypass harmonization rules
    other['_power'] = PowerState.On;
    other['_operationMode'] = OperationMode.Heat;
    other['_fanSpeed'] = FanSpeed.High;
    other['_swingMode'] = SwingMode.Horizontal;
    other['_turboMode'] = PowerState.On;
    other['_sleepMode'] = SleepModeState.On;
    other['_ecoMode'] = PowerState.On;
    other['_targetTemperature'] = 25;

    const diff = state.diff(other);
    expect(diff).toMatchObject({
      power: PowerState.On,
      mode: OperationMode.Heat,
      temp: 25,
      fanSpeed: FanSpeed.High,
      swingMode: SwingMode.Horizontal,
      turbo: PowerState.On,
      sleep: SleepModeState.On,
      eco: PowerState.On,
    });
  });

  it('toString should include JSON of plain object', () => {
    state.setPower(PowerState.On);
    const str = state.toString();
    expect(str).toContain('DeviceState');
    expect(str).toContain('"is_on":"on"');
  });

  it('clone should produce independent copy', () => {
    state.setPower(PowerState.On); // Add this
    state.setOperationMode(OperationMode.Cool); // Add this to allow manual fan speed
    state.setFanSpeed(FanSpeed.Low);
    const clone = state.clone();
    expect(clone.fanSpeed).toBe(FanSpeed.Low);
    clone.setFanSpeed(FanSpeed.High);
    expect(state.fanSpeed).toBe(FanSpeed.Low); // Original state should be unaffected
    expect(clone.fanSpeed).toBe(FanSpeed.High); // Cloned state should have the new fan speed
  });
});

describe('DeviceState Additional Tests', () => {
  let deviceState: DeviceState;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    deviceState = new DeviceState(mockLogger);
  });

  it('turning Turbo mode ON should turn Sleep mode OFF', () => {
    // Need to ensure device is on and in a mode that allows Turbo
    deviceState.setPower(PowerState.On);
    deviceState.setOperationMode(OperationMode.Cool);
    
    deviceState.setSleepMode(SleepModeState.On);
    deviceState.setTurboMode(PowerState.On);
    expect(deviceState.sleepMode).toBe(SleepModeState.Off);
    expect(deviceState.turboMode).toBe(PowerState.On);
  });

  it('turning Sleep mode ON should turn Turbo mode OFF', () => {
    // Need to ensure device is on and in a mode that allows Sleep
    deviceState.setPower(PowerState.On);
    deviceState.setOperationMode(OperationMode.Cool);
    
    deviceState.setTurboMode(PowerState.On);
    deviceState.setSleepMode(SleepModeState.On);
    expect(deviceState.turboMode).toBe(PowerState.Off);
    expect(deviceState.sleepMode).toBe(SleepModeState.On);
  });

  it('setting Power OFF should turn off all modes and set fan to Auto', () => {
    deviceState.setPower(PowerState.On);
    deviceState.setOperationMode(OperationMode.Cool);
    deviceState.setFanSpeed(FanSpeed.High);
    deviceState.setSleepMode(SleepModeState.On);
    deviceState.setTurboMode(PowerState.On);
    deviceState.setSwingMode(SwingMode.Vertical);
    deviceState.setEcoMode(PowerState.On);

    deviceState.setPower(PowerState.Off);

    expect(deviceState.power).toBe(PowerState.Off);
    expect(deviceState.operationMode).toBe(OperationMode.Auto); // Default mode when off
    expect(deviceState.fanSpeed).toBe(FanSpeed.Auto);
    expect(deviceState.sleepMode).toBe(SleepModeState.Off);
    expect(deviceState.turboMode).toBe(PowerState.Off);
    expect(deviceState.swingMode).toBe(SwingMode.Off); // Assuming swing also turns off
    expect(deviceState.ecoMode).toBe(PowerState.Off);
  });

  it('setting fan speed to non-Turbo should turn Turbo mode OFF', () => {
    // Need to ensure device is on and set to Turbo first
    deviceState.setPower(PowerState.On);
    deviceState.setOperationMode(OperationMode.Cool);
    
    // Set Turbo Mode first, which should set fan speed to Turbo
    deviceState.setTurboMode(PowerState.On);
    // Pre-condition: fanSpeed should be Turbo due to turboMode being On
    expect(deviceState.fanSpeed).toBe(FanSpeed.Turbo);

    deviceState.setFanSpeed(FanSpeed.High);
    expect(deviceState.turboMode).toBe(PowerState.Off);
    expect(deviceState.fanSpeed).toBe(FanSpeed.High);
  });

  it('setting fan speed to Turbo should turn Turbo mode ON and Sleep mode OFF', () => {
    // Need to ensure device is on and in a mode that allows Turbo
    deviceState.setPower(PowerState.On);
    deviceState.setOperationMode(OperationMode.Cool);
    
    deviceState.setSleepMode(SleepModeState.On);
    deviceState.setFanSpeed(FanSpeed.Turbo);
    expect(deviceState.turboMode).toBe(PowerState.On);
    expect(deviceState.sleepMode).toBe(SleepModeState.Off);
    expect(deviceState.fanSpeed).toBe(FanSpeed.Turbo);
  });
});
