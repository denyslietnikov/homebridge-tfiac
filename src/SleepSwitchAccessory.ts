import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import { SleepModeState, PowerState } from './enums.js';
import type { AirConditionerStatus } from './AirConditionerAPI.js';

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
      // Sleep on for both complex enum (opt_sleepMode) or simple 'opt_sleep'
      (status: Partial<AirConditionerStatus> & { opt_sleep?: PowerState }) =>
        status.opt_sleep === PowerState.On || status.opt_sleepMode === SleepModeState.On,
      async (value) => {
        const state = value ? SleepModeState.On : SleepModeState.Off;
        await this.cacheManager.api.setSleepState(state);
      },
      'Sleep',
    );
  }
}
