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
      (
        status: Partial<AirConditionerStatus> & {
          opt_sleepMode?: string;
          opt_sleep?: PowerState;
          opt_turbo?: PowerState;
        },
      ) => {
        // Only active when AC is on, Turbo is off, and the low-level sleep flag is on
        if (status.is_on !== PowerState.On || status.opt_turbo === PowerState.On || status.opt_sleep !== PowerState.On) {
          return false;
        }
        // As a further safeguard, check for the detailed sleepMode string
        const mode = status.opt_sleepMode;
        if (typeof mode === 'string') {
          const onPrefix = SleepModeState.On.split(':')[0];
          return mode === SleepModeState.On || mode.startsWith(onPrefix);
        }
        // If the raw opt_sleep flag is on, assume Sleep is active
        return true;
      },
      async (value) => {
        const state = value ? SleepModeState.On : SleepModeState.Off;
        
        // Get current device state
        const deviceState = this.cacheManager.getDeviceState();
        
        if (value) {
          // Only allow enabling Sleep if AC is on
          if (deviceState.power !== PowerState.On) {
            this.platform.log.info('Cannot enable Sleep mode when AC is off');
            // Update the switch to reflect the actual state (off)
            if (this.service) {
              this.service.updateCharacteristic(this.platform.Characteristic.On, false);
            }
            return;
          }

          // Update the device state optimistically
          deviceState.setSleepMode(state);
          
          // Disable Turbo and enable Sleep in one atomic command
          await this.cacheManager.api.setTurboAndSleep(FanSpeed.Low, state);
        } else {
          // Update the device state optimistically
          deviceState.setSleepMode(state);
          
          // Simply turn off Sleep mode
          await this.cacheManager.api.setSleepState(state);
        }
      },
      'Sleep',
    );
  }
}
