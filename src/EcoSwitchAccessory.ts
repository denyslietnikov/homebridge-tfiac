import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import { PowerState } from './enums.js';

export class EcoSwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    super(
      platform,
      accessory,
      'Eco',
      'eco',
      (status) => status.opt_eco === PowerState.On,
      async (value) => {
        const state = value ? PowerState.On : PowerState.Off;
        await this.cacheManager.api.setEcoState(state);
      },
      'Eco',
    );
  }
}
