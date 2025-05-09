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
      (status: Partial<AirConditionerStatus> & { opt_sleepMode?: string; opt_turbo?: PowerState }) => {
        // Sleep only applies when AC is on and Turbo is off
        if (status.is_on !== PowerState.On || status.opt_turbo === PowerState.On) {
          return false;
        }
        // Only consider Sleep active if opt_sleepMode exactly matches SleepModeState.On
        // or starts with its prefix (e.g., 'sleepMode1')
        const mode = status.opt_sleepMode;
        if (typeof mode === 'string') {
          const onPrefix = SleepModeState.On.split(':')[0];
          return mode === SleepModeState.On || mode.startsWith(onPrefix);
        }
        return false;
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

          // Disable Turbo and enable Sleep in one atomic command
          await this.cacheManager.api.setTurboAndSleep(FanSpeed.Low, state);
        } else {
          // Simply turn off Sleep mode
          await this.cacheManager.api.setSleepState(state);
        }
      },
      'Sleep',
    );
  }
}
