// settings.ts

import { PlatformConfig } from 'homebridge';

/**
 * This is the name of the platform that users will use to register the plugin in the Homebridge config.json
 */
export const PLATFORM_NAME = 'TfiacPlatform';

/**
 * This must match the name of your plugin as defined the package.json `name` property
 */
export const PLUGIN_NAME = 'homebridge-tfiac';

/**
 * Describes a single device config entry (an air conditioner).
 */
export interface TfiacDeviceConfig {
    name: string;            // mandatory
    ip: string;              // mandatory
    port?: number;           // optional
    updateInterval?: number; // optional
    
    // Temperature unit configuration
    useFahrenheit?: boolean;     // Whether the device protocol expects Fahrenheit (default: true, uses Fahrenheit)
    
    // Services configuration settings
    enableDisplay?: boolean;         // show display switch
    enableSleep?: boolean;           // show sleep mode switch
    enableDry?: boolean;             // show dry mode switch
    enableFanOnly?: boolean;         // show fan-only mode switch
    enableStandaloneFan?: boolean;   // show standalone fan switch
    enableHorizontalSwing?: boolean; // show horizontal swing switch
    enableTurbo?: boolean;           // show turbo mode switch
    enableEco?: boolean;             // show eco mode switch
    enableBeep?: boolean;            // show beep switch
    enableFanSpeed?: boolean;        // show fan speed control
    enableTemperature?: boolean;     // show temperature sensor
    enableIFeelSensor?: boolean;     // show iFeel mode sensor
    
    // Alternative format (for backwards compatibility)
    enableDisplaySwitch?: boolean;   // show display switch
    enableSleepSwitch?: boolean;     // show sleep mode switch
    enableDrySwitch?: boolean;       // show dry mode switch
    enableFanOnlySwitch?: boolean;   // show fan-only mode switch
    enableStandaloneFanSwitch?: boolean; // show standalone fan switch  
    enableHorizontalSwingSwitch?: boolean; // show horizontal swing switch
    enableTurboSwitch?: boolean;     // show turbo mode switch
    enableEcoSwitch?: boolean;       // show eco mode switch
    enableBeepSwitch?: boolean;      // show beep switch
    enableFanSpeedSwitch?: boolean;  // show fan speed control
    
    // Other settings
    temperatureCorrection?: number;  // temperature correction offset
    debug?: boolean;                 // enable debug logging for this device
    uiHoldSeconds?: number | Record<string, number>; // UI hold timeout in seconds, globally or per switch type
    
    [key: string]: string | number | boolean | object | undefined;  // Support for additional properties
}

/**
 * Describes the overall platform config, which may include multiple devices.
 */
export interface TfiacPlatformConfig extends PlatformConfig {
    devices?: TfiacDeviceConfig[];
    enableDiscovery?: boolean; 
    debug?: boolean; // enable plugin-specific debug logging
    minRequestDelay?: number; // Minimum delay in milliseconds between sending commands to the AC
    uiHoldSeconds?: number; // Global UI hold timeout in seconds
}