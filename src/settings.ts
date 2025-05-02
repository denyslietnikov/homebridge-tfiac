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
    enableSleep?: boolean;            // show sleep mode switch
    enableDisplay?: boolean;          // show display switch
    enableDry?: boolean;              // show dry mode switch
    enableFanOnly?: boolean;          // show fan-only mode switch
    enableStandaloneFan?: boolean;    // show standalone fan switch
    enableHorizontalSwing?: boolean;  // show horizontal swing switch
    enableTurbo?: boolean;            // show turbo mode switch
    enableEco?: boolean;              // show eco mode switch
    enableBeep?: boolean;             // show beep switch
    enableFanSpeed?: boolean;         // show fan speed control
    enableTemperature?: boolean;      // show temperature sensor
    [key: string]: string | number | boolean | undefined;  // Add index signature
}

/**
 * Describes the overall platform config, which may include multiple devices.
 */
export interface TfiacPlatformConfig extends PlatformConfig {
    devices?: TfiacDeviceConfig[];
    enableDiscovery?: boolean; // Add this line
    debug?: boolean; // enable plugin-specific debug logging
}