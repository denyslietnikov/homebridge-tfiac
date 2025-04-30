import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import { PowerState } from './enums.js';

export class TurboSwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    super(
      platform,
      accessory,
      'Turbo',
      'turbo',
      (status) => status.opt_turbo === PowerState.On,
      async (value) => {
        const state = value ? PowerState.On : PowerState.Off;
        await this.cacheManager.api.setTurboState(state);
      },
      'Turbo',
    );
  }
}
