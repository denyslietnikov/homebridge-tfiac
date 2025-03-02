import { PlatformConfig } from 'homebridge';

export const PLATFORM_NAME = 'TfiacPlatform';
export const PLUGIN_NAME = 'homebridge-tfiac';

/**
 * Describes a single device config entry (an air conditioner).
 */
export interface TfiacDeviceConfig {
    name: string;          // <== mandatory
    ip: string;            // <== mandatory
    port?: number;         // optional
    updateInterval?: number;
  }

/**
 * Describes the overall platform config, which may include multiple devices.
 */
export interface TfiacPlatformConfig extends PlatformConfig {
    devices?: TfiacDeviceConfig[];
  }