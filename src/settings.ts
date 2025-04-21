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
    name: string;          // <== mandatory
    ip: string;            // <== mandatory
    port?: number;         // optional
    updateInterval?: number;
    enableSleep?: boolean; // optional
    enableDisplay?: boolean; // optional
}

/**
 * Describes the overall platform config, which may include multiple devices.
 */
export interface TfiacPlatformConfig extends PlatformConfig {
    devices?: TfiacDeviceConfig[];
    enableDiscovery?: boolean; // Add this line
}