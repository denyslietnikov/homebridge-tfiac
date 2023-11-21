// settings.ts
/**
 * This must match the name of your plugin as defined in package.json
 */
export const PLUGIN_NAME = 'homebridge-tfiac';

export interface DeviceConfig {
  name: string;
  ip: string;
  port: number;
}
