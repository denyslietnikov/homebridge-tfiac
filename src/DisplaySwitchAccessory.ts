import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BooleanSwitchAccessory } from './BooleanSwitchAccessory.js';

/**
 * Accessory for controlling the display (light) of the air conditioner.
 * Extends BooleanSwitchAccessory to provide a simple On/Off switch.
 */
export class DisplaySwitchAccessory extends BooleanSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    super(
      platform,
      accessory,
      'Display',
      'opt_display', // apiStatusKey
      'setDisplayMode', // deviceStateSetterName
    );
  }

  /**
   * Handle requests to get the current value of the "On" characteristic.
   * This method matches the signature of the base class method.
   */
  protected handleGet(callback?: (error: Error | null, value?: boolean) => void): boolean {
    // Support both promise-based (homebridge/HAP v1.4.0+) and callback-based API
    const value = this.cachedStatus ? (status => status.opt_display === PowerState.On)(this.cachedStatus) : false;
    
    if (callback && typeof callback === 'function') {
      // Callback-style API (for backward compatibility)
      callback(null, value);
    }
    
    // Return the value directly - works for promise pattern
    return value;
  }
}
