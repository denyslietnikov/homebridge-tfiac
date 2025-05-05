import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import { SleepModeState } from './enums.js';

export class SleepSwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    super(
      platform,
      accessory,
      'Sleep',
      'sleep',
      (status) => {
        // Check the opt_sleepMode value
        // Consider Sleep turned off if the value starts with 'off'
        // or equals SleepModeState.Off
        if (!status.opt_sleepMode) {
          return false;
        }
        
        if (typeof status.opt_sleepMode === 'string') {
          return !status.opt_sleepMode.toLowerCase().startsWith('off');
        }
        
        return status.opt_sleepMode !== SleepModeState.Off;
      },
      async (value) => {
        const state = value ? SleepModeState.On : SleepModeState.Off;
        await this.cacheManager.api.setSleepState(state);
      },
      'Sleep',
    );
  }
}
