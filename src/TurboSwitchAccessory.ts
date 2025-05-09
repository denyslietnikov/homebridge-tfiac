import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import { PowerState, FanSpeed, SleepModeState } from './enums.js';

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
          this.platform.log.info('Disabling Turbo and setting fan speed to Auto in one command');
          await this.cacheManager.api.setFanAndSleepState(FanSpeed.Auto, SleepModeState.Off);
        }
      },
      'Turbo',
    );
    
    // Debug logging is now centralized in platformAccessory.ts
  }
}
