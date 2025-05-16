import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import { PowerState } from './enums.js';

/**
 * Accessory for controlling the display (light) of the air conditioner.
 * Extends BaseSwitchAccessory to provide a simple On/Off switch.
 */
export class DisplaySwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
    // cacheManager: CacheManager, // Removed: Now available via this.cacheManager from BaseSwitchAccessory
  ) {
    const displayName = 'Display';
    const serviceSubtype = 'display'; // Unique subtype for this switch service

    super(
      platform,
      accessory,
      displayName, // serviceName for BaseSwitchAccessory
      serviceSubtype, // serviceSubtype for BaseSwitchAccessory
      // getStatusValue: (status) => boolean. Fetches current display state from AirConditionerStatus.
      (status) => {
        // Add extra checks to prevent errors with undefined properties
        if (!status || status.opt_display === undefined) {
          return false;
        }
        return status.opt_display === PowerState.On;
      },
      // setApiState: (value: boolean) => Promise<void>. Sets display state via CacheManager.
      async (value: boolean) => {
        platform.log.debug(`SET ${displayName} -> ${value ? 'ON' : 'OFF'}`);
        const desiredState = this.cacheManager.getDeviceState().clone();
        desiredState.setDisplayMode(value ? PowerState.On : PowerState.Off);
        await this.cacheManager.applyStateToDevice(desiredState);
      },
      displayName, // logPrefix for BaseSwitchAccessory
    );
  }
}
