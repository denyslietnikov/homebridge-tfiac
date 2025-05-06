// src/enums.ts

/**
 * Represents the power state of the device or an option.
 */
export enum PowerState {
  Off = 'off',
  On = 'on',
}

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
  Low = 'Low',
  Middle = 'Middle',
  High = 'High',
  Auto = 'Auto',
}

/**
 * Mapping from FanSpeed modes to HomeKit RotationSpeed percentages.
 */
export const FanSpeedPercentMap: Record<FanSpeed, number> = {
  [FanSpeed.Low]: 25,
  [FanSpeed.Middle]: 50,
  [FanSpeed.High]: 75,
  [FanSpeed.Auto]: 50,
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
