import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import { SleepModeState, PowerState, FanSpeed } from './enums.js';
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
        
        if (value) {
          // If Sleep is being enabled, check and turn off Turbo if necessary
          const status = await this.cacheManager.api.updateState();
          if (status.opt_turbo === PowerState.On) {
            // Turn off Turbo when enabling Sleep
            await this.cacheManager.api.setTurboState(PowerState.Off);
          }
          
          // Set sleep mode
          await this.cacheManager.api.setSleepState(state);
          
          // Set fan to Low speed in Sleep mode
          await this.cacheManager.api.setFanSpeed(FanSpeed.Low);
        } else {
          // Simply turn off Sleep mode
          await this.cacheManager.api.setSleepState(state);
        }
      },
      'Sleep',
    );
    
    // Add debug event listener with Sleep API prefix
    if (this.platform.config.debug) {
      this.platform.log.debug(`[${this.accessory.displayName}] Sleep API: debug listener attached`);
      this.cacheManager.api.on('debug', msg =>
        this.platform.log.debug(`[${this.accessory.displayName}] Sleep API: ${msg}`),
      );
    }
  }
}
