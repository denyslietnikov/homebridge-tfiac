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

  public async setEcoState(value: boolean): Promise<void> {
    const state = value ? PowerState.On : PowerState.Off;
    // Check if cacheManager and api exist before trying to access methods
    if (!this.cacheManager?.api?.setEcoState) {
      throw new Error('API or setEcoState method is not available');
    }
    await this.cacheManager.api.setEcoState(state);
    this.cacheManager.clear();
  }
}
