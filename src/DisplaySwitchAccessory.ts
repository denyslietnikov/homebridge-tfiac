import { PlatformAccessory, CharacteristicValue, CharacteristicSetCallback } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import { PowerState } from './enums.js';
import type { AirConditionerStatus } from './AirConditionerAPI.js';

export class DisplaySwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    super(
      platform,
      accessory,
      'Display',
      'display',
      (status: Partial<AirConditionerStatus>) => status.opt_display === PowerState.On,
      async (value) => {
        const state = value ? PowerState.On : PowerState.Off;
        await this.cacheManager.api.setDisplayState(state);
      },
      'Display',
    );
    
    // Debug logging is now centralized in platformAccessory.ts
  }

  /**
   * Handle requests to get the current value of the "On" characteristic.
   * This method matches the signature of the base class method.
   */
  public handleGet(callback?: (error: Error | null, value?: boolean) => void): boolean {
    // Support both promise-based (homebridge/HAP v1.4.0+) and callback-based API
    const value = this.cachedStatus ? (status => status.opt_display === PowerState.On)(this.cachedStatus) : false;
    
    if (callback && typeof callback === 'function') {
      // Callback-style API (for backward compatibility)
      callback(null, value);
    }
    
    // Return the value directly - works for promise pattern
    return value;
  }

  protected async handleSet(value: CharacteristicValue, callback?: (error: Error | null) => void): Promise<void> {
    // Call base implementation
    await super.handleSet(value, callback as CharacteristicSetCallback);
    // Clear cache so next get fetches updated state
    this.cacheManager.clear();
  }
}
