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
        const targetSleepValue = value ? SleepModeState.On : SleepModeState.Off;
        
        const currentDeviceState = this.cacheManager.getDeviceState();
        
        if (value && currentDeviceState.power !== PowerState.On) {
          this.platform.log.info('[SleepSwitchAccessory] Cannot enable Sleep mode when AC is off. Command not sent.');
          // The UI will remain off because BaseSwitchAccessory's stateChanged listener
          // will use getStatusValue, which checks if AC is on.
          return; 
        }

        // Create a new DeviceState object representing the desired state.
        const desiredState = currentDeviceState.clone();
        
        // Set the desired sleep mode.
        // According to Refactoring Plan Point 5, DeviceState setters (like setSleepMode)
        // should handle internal harmonization (e.g., if sleep=true -> turbo=false).
        desiredState.setSleepMode(targetSleepValue);
        
        // If DeviceState.setSleepMode doesn't fully handle related changes like turning off turbo,
        // it might be set explicitly on desiredState here. However, Point 5 aims for this
        // logic to be within DeviceState setters.
        // Example: if (value) { desiredState.setTurboMode(PowerState.Off); }


        this.platform.log.debug(`[SleepSwitchAccessory] Requesting state change via CacheManager. Desired sleep state: ${targetSleepValue}`);
        // CacheManager.applyStateToDevice will diff the desiredState with the actual current state
        // (after potentially refreshing it) and send the appropriate setOptionsCombined command.
        // It will also ensure the central DeviceState is updated, triggering the stateChanged event
        // for BaseSwitchAccessory to update the characteristic.
        await this.cacheManager.applyStateToDevice(desiredState);
      },
      'Sleep',
    );
  }
}
