import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import { PowerState } from './enums.js';

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
      (status) => status.opt_display === PowerState.On,
      async (value) => {
        const state = value ? PowerState.On : PowerState.Off;
        await this.cacheManager.api.setDisplayState(state);
      },
      'Display',
    );
  }
}
