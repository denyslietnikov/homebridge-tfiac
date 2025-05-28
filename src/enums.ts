// src/enums.ts

/**
 * Represents the power state of the device or an option.
 */
export enum PowerState {
  Off = 'off',
  On = 'on',
}

/**
 * Service subtypes - single source of truth for all accessory service subtypes
 */
export const SUBTYPES = {
  display: 'display',
  sleep: 'sleep',
  fanSpeed: 'fan_speed',
  dry: 'dry',
  fanOnly: 'fanonly',
  turbo: 'turbo',
  eco: 'eco',
  standaloneFan: 'standalonefan',
  horizontalSwing: 'horizontalswing',
  beep: 'beep',
  indoorTemperature: 'indoor_temperature',
  outdoorTemperature: 'outdoor_temperature',
  iFeelSensor: 'ifeel_sensor',
} as const;

/**
 * Represents the main operation modes of the air conditioner.
 */
export enum OperationMode {
  Cool = 'cool',
  Heat = 'heat',
  Auto = 'auto',
  FanOnly = 'fan_only', // Corresponds to 'fan_only' in the API
  Dry = 'dehumi', // Corresponds to 'dehumi' in the API
  SelfFeel = 'selfFeel', // Another name for Auto?
}

/**
 * Represents the fan speed modes.
 */
export enum FanSpeed {
  Silent = 'Silent',
  Low = 'Low',
  MediumLow = 'MediumLow',
  Medium = 'Medium', // Renamed from Middle
  MediumHigh = 'MediumHigh',
  High = 'High',
  Turbo = 'Turbo',
  Auto = 'Auto',
}

/**
 * Mapping from FanSpeed modes to HomeKit RotationSpeed percentages.
 */
export const FanSpeedPercentMap: Record<FanSpeed, number> = {
  [FanSpeed.Auto]: 0,
  [FanSpeed.Silent]: 15,
  [FanSpeed.Low]: 30,
  [FanSpeed.MediumLow]: 45,
  [FanSpeed.Medium]: 60, // Was Middle, percentage adjusted
  [FanSpeed.MediumHigh]: 75,
  [FanSpeed.High]: 100, // Changed from 90 to 100
  [FanSpeed.Turbo]: 100,
};

/**
 * Represents the swing modes.
 */
export enum SwingMode {
  Off = 'Off',
  Vertical = 'Vertical',
  Horizontal = 'Horizontal',
  Both = 'Both',
}

/**
 * Represents the sleep mode state.
 * Note: The API uses a complex string for 'on'.
 */
export enum SleepModeState {
  Off = 'off',
  On = 'sleepMode1:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0',
}
