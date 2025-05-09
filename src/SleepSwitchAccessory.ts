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
      (status: Partial<AirConditionerStatus> & { opt_sleep?: PowerState }) => {
        // Sleep mode should always return false when AC is off
        if (status.is_on !== PowerState.On) {
          return false;
        }
        return status.opt_sleep === PowerState.On || status.opt_sleepMode === SleepModeState.On;
      },
      async (value) => {
        const state = value ? SleepModeState.On : SleepModeState.Off;
        
        // Get current status
        const status = await this.cacheManager.api.updateState();
        
        if (value) {
          // Only allow enabling Sleep if AC is on
          if (status.is_on !== PowerState.On) {
            this.platform.log.info('Cannot enable Sleep mode when AC is off');
            // Update the switch to reflect the actual state (off)
            if (this.service) {
              this.service.updateCharacteristic(this.platform.Characteristic.On, false);
            }
            return;
          }
          
          if (status.opt_turbo === PowerState.On) {
            // First turn off Turbo mode if it's on
            this.platform.log.debug('Turning off Turbo mode before enabling Sleep');
            await this.cacheManager.api.setTurboState(PowerState.Off);
          }
          
          // Use combined command to set both sleep and fan speed at once
          // This reduces the number of beeps from multiple commands
          await this.cacheManager.api.setFanAndSleepState(FanSpeed.Low, state);
        } else {
          // Simply turn off Sleep mode
          await this.cacheManager.api.setSleepState(state);
        }
      },
      'Sleep',
    );
  }
}
