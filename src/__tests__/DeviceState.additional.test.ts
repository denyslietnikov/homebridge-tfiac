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
    state.setEcoMode(PowerState.On);
    expect(state.ecoMode).toBe(PowerState.On);
    state.setDisplayMode(PowerState.Off);
    expect(state.displayMode).toBe(PowerState.Off);
    state.setBeepMode(PowerState.Off);
    expect(state.beepMode).toBe(PowerState.Off);
    expect(spy).toHaveBeenCalledTimes(3);
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
    other['_displayMode'] = PowerState.Off;
    other['_beepMode'] = PowerState.Off;
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
      display: PowerState.Off,
      beep: PowerState.Off,
    });
  });

  it('toString should include JSON of plain object', () => {
    state.setPower(PowerState.On);
    const str = state.toString();
    expect(str).toContain('DeviceState');
    expect(str).toContain('"is_on":"on"');
  });

  it('clone should produce independent copy', () => {
    state.setFanSpeed(FanSpeed.Low);
    const clone = state.clone();
    expect(clone.fanSpeed).toBe(FanSpeed.Low);
    clone.setFanSpeed(FanSpeed.High);
    expect(state.fanSpeed).toBe(FanSpeed.Low);
    expect(clone.fanSpeed).toBe(FanSpeed.High);
  });
});
