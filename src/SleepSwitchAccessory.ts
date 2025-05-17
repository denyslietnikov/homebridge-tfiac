import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import { SleepModeState, PowerState } from './enums.js';
import type { AirConditionerStatus } from './AirConditionerAPI.js';
import { DeviceState } from './state/DeviceState.js';

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
        // Check if we received a DeviceState object
        if (status instanceof DeviceState) {
          // Convert DeviceState to API status format
          status = status.toApiStatus();
        }
        
        // Add null/undefined check for the entire status object
        if (!status) {
          return false;
        }
        
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
        const currentDeviceState = this.cacheManager.getDeviceState();
        // Do not enable Sleep mode if AC power is off
        if (value && currentDeviceState.power !== PowerState.On) {
          this.platform.log.info(
            `[${this.logPrefix}] Cannot enable Sleep mode when AC is off. Request ignored.`,
          );
          return;
        }
        const targetSleepValue = value ? SleepModeState.On : SleepModeState.Off;
        
        const desiredState = currentDeviceState.clone();
        desiredState.setSleepMode(targetSleepValue);
        
        this.platform.log.debug(
          `[SleepSwitchAccessory] Requesting state change via CacheManager. Desired sleep state: ${targetSleepValue}`,
        );
        await this.cacheManager.applyStateToDevice(desiredState);
      },
      'Sleep',
    );
  }
}
