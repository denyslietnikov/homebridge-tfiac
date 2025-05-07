import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import { PowerState } from './enums.js';
import { FanSpeed } from './enums.js';

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
        // When turning Turbo on/off, update the fan speed for proper synchronization
        if (value) {
          // When Turbo is turned on, set fan mode to Turbo
          await this.cacheManager.api.setTurboState(state);
        } else {
          // When Turbo is turned off, set to Auto mode
          // First turn off Turbo state
          await this.cacheManager.api.setTurboState(state);
          // Then set fan speed to Auto (0%)
          await this.cacheManager.api.setFanSpeed(FanSpeed.Auto);
        }
      },
      'Turbo',
    );
  }
}
