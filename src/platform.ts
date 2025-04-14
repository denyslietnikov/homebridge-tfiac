// platform.ts

import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME, TfiacPlatformConfig } from './settings.js';
import { TfiacPlatformAccessory } from './platformAccessory.js';

export class TfiacPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // Array of discovered accessories
  private readonly accessories: PlatformAccessory[] = [];

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig, // or TfiacPlatformConfig
    public readonly api: API,
  ) {
    // Initialize Service and Characteristic after api is assigned
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    this.log.debug('TfiacPlatform constructor called');

    // Homebridge will fire "didFinishLaunching" when it has loaded all configs
    this.api.on('didFinishLaunching', () => {
      this.log.debug('didFinishLaunching callback');
      this.discoverDevices();
    });
  }

  /**
   * Main logic: read devices from config and register accessories.
   */
  discoverDevices() {
    // The platform config may contain a "devices" array 
    const devices = (this.config.devices || []) as TfiacPlatformConfig[];

    if (!devices || devices.length === 0) {
      this.log.info('No devices to register');
      return;
    }

    for (const device of devices) {
      if (!device.ip) {
        this.log.error('Missing required IP address for device:', device.name);
        continue;
      }

      try {
        // Generate a unique UUID based on IP + device name
        const uuid = this.api.hap.uuid.generate(device.ip + device.name);

        // Check if we already have an accessory for this device
        const existingAccessory = this.accessories.find((acc) => acc.UUID === uuid);

        if (existingAccessory) {
          // Update context and re-initialize
          existingAccessory.context.deviceConfig = device;
          existingAccessory.displayName = device.name ?? 'Unnamed Tfiac Device';
          this.api.updatePlatformAccessories([existingAccessory]);
          new TfiacPlatformAccessory(this, existingAccessory);

          this.log.info(`Updated existing accessory: ${device.name}`);
        } else {
          // Create a brand new accessory
          const safeName = device.name ?? 'Unnamed TFIAC Device';
          this.log.info(`Adding new accessory: ${safeName}`);

          try {
            const accessory = new this.api.platformAccessory(safeName, uuid);
            accessory.context.deviceConfig = device;
            new TfiacPlatformAccessory(this, accessory);

            // Register the accessory with Homebridge
            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          } catch (error) {
            this.log.error('Failed to initialize device:', error);
          }
        }
      } catch (error) {
        this.log.error('Failed to register platform accessories:', error);
      }
    }
  }

  /**
   * Homebridge will call this method for restored cached accessories.
   * We just store them in the array for reference and later usage.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.debug(`Loading accessory from cache: ${accessory.displayName}`);
    this.accessories.push(accessory);
  }
}