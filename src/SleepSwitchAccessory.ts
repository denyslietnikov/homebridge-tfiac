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
      (status) => status.opt_sleepMode !== SleepModeState.Off,
      async (value) => {
        const state = value ? SleepModeState.On : SleepModeState.Off;
        await this.cacheManager.api.setSleepState(state);
      },
      'Sleep',
    );
  }
}
