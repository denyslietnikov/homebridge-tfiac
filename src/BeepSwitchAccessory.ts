import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import { PowerState } from './enums.js';

export class BeepSwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    super(
      platform,
      accessory,
      'Beep',
      'beep',
      (status) => status.opt_beep === PowerState.On,
      async (value) => {
        const state = value ? PowerState.On : PowerState.Off;
        await this.cacheManager.api.setBeepState(state);
      },
      'Beep',
    );
  }
}
