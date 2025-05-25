import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BooleanSwitchAccessory, DeviceStateModifierFn, GetStatusValueFromApiFn } from './BooleanSwitchAccessory.js';
import { PowerState, SleepModeState } from './enums.js';
import { DeviceState } from './state/DeviceState.js';
import { AirConditionerStatus } from './AirConditionerAPI.js';

export class TurboSwitchAccessory extends BooleanSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    const getStatusValue: GetStatusValueFromApiFn = (status: Partial<AirConditionerStatus>) => {
      if (!status || status.opt_turbo === undefined) {
        return false;
      }
      return status.opt_turbo === PowerState.On;
    };

    const deviceStateModifier: DeviceStateModifierFn = (state: DeviceState, value: boolean) => {
      if (value) { // Turbo ON
        // Prevent enabling Turbo while Sleep is active
        if (state.sleepMode === SleepModeState.On) {
          platform.log.info('[TurboSwitchAccessory] Cannot enable Turbo while Sleep is active. Request ignored.');
          return false;
        }
        platform.log.info('[TurboSwitchAccessory] Requesting Turbo ON via BooleanSwitchAccessory');
        state.setTurboMode(PowerState.On);
        // Turn off sleep mode when turbo is enabled
        state.setSleepMode(SleepModeState.Off);
      } else { // Turbo OFF
        platform.log.info('[TurboSwitchAccessory] Requesting Turbo OFF via BooleanSwitchAccessory');
        state.setTurboMode(PowerState.Off);
        // Explicitly turn off sleep mode when turning off turbo to prevent automatic sleep activation
        // This ensures the sleep flag is included in the API command
        state.setSleepMode(SleepModeState.Off);
        // Note: DeviceState harmonization automatically handles fan speed reset and sleep mode conflicts
      }
      return true; // Return true to indicate API call should proceed
    };

    super(
      platform,
      accessory,
      'Turbo',
      getStatusValue,
      deviceStateModifier,
    );
  }
}
