// filepath: src/state/DeviceState.ts
import { EventEmitter } from 'events';
import { AirConditionerStatus } from '../AirConditionerAPI.js';
import { 
  PowerState, 
  OperationMode, 
  FanSpeed, 
  SwingMode, 
  SleepModeState, 
} from '../enums.js';

/**
 * Represents the current state of an air conditioner device.
 * Acts as a single source of truth for all accessory services.
 * Emits events when the state changes to notify UI components.
 */
class DeviceState extends EventEmitter {
  // Device power state
  private _power: PowerState = PowerState.Off;
  
  // Core operational properties
  private _operationMode: OperationMode = OperationMode.Auto;
  private _targetTemperature: number = 22; // in Celsius
  private _currentTemperature: number = 20; // in Celsius
  private _outdoorTemperature: number | null = null;
  
  // Fan and airflow settings
  private _fanSpeed: FanSpeed = FanSpeed.Auto;
  private _swingMode: SwingMode = SwingMode.Off;
  
  // Optional features
  private _turboMode: PowerState = PowerState.Off;
  private _ecoMode: PowerState = PowerState.Off;
  private _displayMode: PowerState = PowerState.On;
  private _beepMode: PowerState = PowerState.On;
  private _sleepMode: SleepModeState = SleepModeState.Off;
  
  // Track last update time
  private _lastUpdated: Date = new Date();
  
  constructor() {
    super();
    // Initialize with default state
  }
  
  /**
   * Updates the state from the device API response.
   * @param status The status object from the air conditioner API
   * @param emitChangeEvent Whether to emit the state changed event
   * @returns boolean True if any property actually changed
   */
  public updateFromDevice(status: Partial<AirConditionerStatus> | null, emitChangeEvent: boolean = true): boolean {
    if (!status) {
      return false;
    }
    
    let changed = false;
    
    // Helper function to update a property and track changes
    const updateProperty = <T>(propertyName: string, newValue: T): void => {
      const currentValue = (this as Record<string, unknown>)[propertyName];
      if (currentValue !== newValue) {
        (this as Record<string, unknown>)[propertyName] = newValue;
        changed = true;
      }
    };
    
    // Update all properties based on the status object
    if (status.is_on !== undefined) {
      updateProperty('_power', status.is_on === 'on' ? PowerState.On : PowerState.Off);
    }
    
    if (status.operation_mode !== undefined) {
      updateProperty('_operationMode', status.operation_mode as OperationMode);
    }
    
    if (status.target_temp !== undefined) {
      updateProperty('_targetTemperature', status.target_temp);
    }
    
    if (status.current_temp !== undefined) {
      updateProperty('_currentTemperature', status.current_temp);
    }
    
    if (status.outdoor_temp !== undefined) {
      updateProperty('_outdoorTemperature', status.outdoor_temp);
    }
    
    if (status.fan_mode !== undefined) {
      updateProperty('_fanSpeed', status.fan_mode as FanSpeed);
    }
    
    if (status.swing_mode !== undefined) {
      updateProperty('_swingMode', status.swing_mode as SwingMode);
    }
    
    if (status.opt_turbo !== undefined) {
      updateProperty('_turboMode', status.opt_turbo as PowerState);
    }
    
    if (status.opt_eco !== undefined) {
      updateProperty('_ecoMode', status.opt_eco as PowerState);
    }
    
    if (status.opt_display !== undefined) {
      updateProperty('_displayMode', status.opt_display as PowerState);
    }
    
    if (status.opt_beep !== undefined) {
      updateProperty('_beepMode', status.opt_beep as PowerState);
    }
    
    if (status.opt_sleepMode !== undefined) {
      updateProperty('_sleepMode', status.opt_sleepMode as SleepModeState);
    } else if (status.opt_sleep !== undefined) {
      // Legacy support for opt_sleep vs opt_sleepMode
      updateProperty('_sleepMode', status.opt_sleep === PowerState.On ? SleepModeState.On : SleepModeState.Off);
    }
    
    if (changed) {
      this._lastUpdated = new Date();
      
      if (emitChangeEvent) {
        this.emit('stateChanged', this);
      }
    }
    
    return changed;
  }
  
  /**
   * Converts the current state to an AirConditionerStatus object
   * that can be used with the API.
   */
  public toApiStatus(): Partial<AirConditionerStatus> {
    return {
      is_on: this._power,
      operation_mode: this._operationMode,
      target_temp: this._targetTemperature,
      current_temp: this._currentTemperature,
      outdoor_temp: this._outdoorTemperature || undefined,
      fan_mode: this._fanSpeed,
      swing_mode: this._swingMode,
      opt_turbo: this._turboMode,
      opt_eco: this._ecoMode,
      opt_display: this._displayMode,
      opt_beep: this._beepMode,
      opt_sleepMode: this._sleepMode,
    };
  }
  
  /**
   * Sets the power state of the device with proper harmonization.
   * Enforces that when power is off, all mode-specific settings are reset.
   */
  public setPower(value: PowerState): void {
    if (this._power === value) {
      return; // No change
    }
    
    this._power = value;
    
    // If turning off, reset all conditional modes
    if (value === PowerState.Off) {
      this._turboMode = PowerState.Off;
      this._sleepMode = SleepModeState.Off;
      // We intentionally don't reset operation mode, temperature, etc.
      // as they should persist for next power on
    }
    
    this._lastUpdated = new Date();
    this.emit('stateChanged', this);
  }
  
  /**
   * Sets the operation mode with proper harmonization.
   * Some modes may have restrictions on fan speeds or other features.
   */
  public setOperationMode(mode: OperationMode): void {
    if (this._operationMode === mode) {
      return; // No change
    }
    
    this._operationMode = mode;
    
    // Handle mode-specific restrictions
    // For example, in Auto mode, we might want to disable manual fan control
    if (mode === OperationMode.Auto) {
      this._fanSpeed = FanSpeed.Auto;
    }
    
    // In Dry mode, fan speed should be Low
    if (mode === OperationMode.Dry) {
      this._fanSpeed = FanSpeed.Low;
      // Turbo doesn't make sense in Dry mode
      this._turboMode = PowerState.Off;
    }
    
    this._lastUpdated = new Date();
    this.emit('stateChanged', this);
  }
  
  /**
   * Sets the fan speed with proper harmonization.
   * Fan speed adjustments may affect other modes like turbo and sleep.
   */
  public setFanSpeed(speed: FanSpeed): void {
    if (this._fanSpeed === speed) {
      return; // No change
    }
    
    this._fanSpeed = speed;
    
    // Harmonize with other settings
    
    // If we're setting to Turbo fan speed, ensure turbo mode is on
    if (speed === FanSpeed.Turbo) {
      this._turboMode = PowerState.On;
      // Sleep and Turbo are mutually exclusive
      this._sleepMode = SleepModeState.Off;
    } else {
      // If we're setting to any other speed, turbo should be off
      this._turboMode = PowerState.Off;
    }
    
    // If we're setting to Low speed and sleep is active, ensure sleep stays on
    // Otherwise, Sleep usually requires Low fan speed
    if (this._sleepMode === SleepModeState.On && speed !== FanSpeed.Low) {
      this._sleepMode = SleepModeState.Off;
    }
    
    this._lastUpdated = new Date();
    this.emit('stateChanged', this);
  }
  
  /**
   * Sets the turbo mode with proper harmonization.
   * Turbo mode affects fan speed and is mutually exclusive with sleep mode.
   */
  public setTurboMode(state: PowerState): void {
    if (this._turboMode === state) {
      return; // No change
    }
    
    this._turboMode = state;
    
    // Harmonize with other settings
    if (state === PowerState.On) {
      // Turbo requires high fan speed
      this._fanSpeed = FanSpeed.Turbo;
      // Sleep and Turbo are mutually exclusive
      this._sleepMode = SleepModeState.Off;
    } else if (this._fanSpeed === FanSpeed.Turbo) {
      // If turning off turbo, revert fan speed to a non-turbo level
      this._fanSpeed = FanSpeed.High;
    }
    
    this._lastUpdated = new Date();
    this.emit('stateChanged', this);
  }
  
  /**
   * Sets the sleep mode with proper harmonization.
   * Sleep mode affects fan speed and is mutually exclusive with turbo mode.
   */
  public setSleepMode(state: SleepModeState): void {
    if (this._sleepMode === state) {
      return; // No change
    }
    
    this._sleepMode = state;
    
    // Harmonize with other settings
    if (state === SleepModeState.On) {
      // Sleep requires low fan speed
      this._fanSpeed = FanSpeed.Low;
      // Turbo and Sleep are mutually exclusive
      this._turboMode = PowerState.Off;
    }
    
    this._lastUpdated = new Date();
    this.emit('stateChanged', this);
  }
  
  /**
   * Sets the swing mode.
   */
  public setSwingMode(mode: SwingMode): void {
    if (this._swingMode === mode) {
      return; // No change
    }
    
    this._swingMode = mode;
    this._lastUpdated = new Date();
    this.emit('stateChanged', this);
  }
  
  /**
   * Sets target temperature within device limits.
   */
  public setTargetTemperature(temperature: number): void {
    // Apply temperature bounds (typical AC range)
    const boundedTemp = Math.min(Math.max(temperature, 16), 30);
    
    if (this._targetTemperature === boundedTemp) {
      return; // No change
    }
    
    this._targetTemperature = boundedTemp;
    this._lastUpdated = new Date();
    this.emit('stateChanged', this);
  }
  
  // Simple setters for other modes
  
  public setEcoMode(state: PowerState): void {
    if (this._ecoMode === state) {
      return;
    }
    
    this._ecoMode = state;
    this._lastUpdated = new Date();
    this.emit('stateChanged', this);
  }
  
  public setDisplayMode(state: PowerState): void {
    if (this._displayMode === state) {
      return;
    }
    
    this._displayMode = state;
    this._lastUpdated = new Date();
    this.emit('stateChanged', this);
  }
  
  public setBeepMode(state: PowerState): void {
    if (this._beepMode === state) {
      return;
    }
    
    this._beepMode = state;
    this._lastUpdated = new Date();
    this.emit('stateChanged', this);
  }
  
  // Getters for all properties
  
  get power(): PowerState {
    return this._power;
  }
  
  get operationMode(): OperationMode {
    return this._operationMode;
  }
  
  get targetTemperature(): number {
    return this._targetTemperature;
  }
  
  get currentTemperature(): number {
    return this._currentTemperature;
  }
  
  get outdoorTemperature(): number | null {
    return this._outdoorTemperature;
  }
  
  get fanSpeed(): FanSpeed {
    return this._fanSpeed;
  }
  
  get swingMode(): SwingMode {
    return this._swingMode;
  }
  
  get turboMode(): PowerState {
    return this._turboMode;
  }
  
  get ecoMode(): PowerState {
    return this._ecoMode;
  }
  
  get displayMode(): PowerState {
    return this._displayMode;
  }
  
  get beepMode(): PowerState {
    return this._beepMode;
  }
  
  get sleepMode(): SleepModeState {
    return this._sleepMode;
  }
  
  get lastUpdated(): Date {
    return new Date(this._lastUpdated);
  }
  
  get isDryMode(): boolean {
    return this.power === PowerState.On && this.operationMode === OperationMode.Dry;
  }
  
  get isCoolMode(): boolean {
    return this.power === PowerState.On && this.operationMode === OperationMode.Cool;
  }
  
  get isHeatMode(): boolean {
    return this.power === PowerState.On && this.operationMode === OperationMode.Heat;
  }
  
  get isAutoMode(): boolean {
    return this.power === PowerState.On && this.operationMode === OperationMode.Auto;
  }
  
  get isFanOnlyMode(): boolean {
    return this.power === PowerState.On && this.operationMode === OperationMode.FanOnly;
  }
  
  /**
   * Returns a formatted string representation of the state.
   */
  public toString(): string {
    return `DeviceState {
      power: ${this._power},
      operation: ${this._operationMode},
      temp: ${this._targetTemperature}°C (current: ${this._currentTemperature}°C),
      fan: ${this._fanSpeed},
      swing: ${this._swingMode},
      turbo: ${this._turboMode},
      sleep: ${this._sleepMode},
      eco: ${this._ecoMode},
      display: ${this._displayMode},
      beep: ${this._beepMode},
      lastUpdated: ${this._lastUpdated.toISOString()}
    }`;
  }
}

// Export as default and named export
export default DeviceState;
export { DeviceState };
