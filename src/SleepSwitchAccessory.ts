import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BooleanSwitchAccessory, DeviceStateModifierFn, GetStatusValueFromApiFn } from './BooleanSwitchAccessory.js';
import { PowerState, SleepModeState } from './enums.js'; // Removed unused FanSpeed import
import { DeviceState } from './state/DeviceState.js';
import { AirConditionerStatus } from './AirConditionerAPI.js';

export class SleepSwitchAccessory extends BooleanSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    const getStatusValue: GetStatusValueFromApiFn = (status: Partial<AirConditionerStatus>) => {
      if (!status || typeof status.opt_sleepMode === 'undefined') {
        return false;
      }
      // Sleep is active if AC is ON, Turbo is OFF, and opt_sleepMode indicates sleep is active.
      // SleepModeState.Off is typically 'off' or 'off:...'
      return status.is_on === PowerState.On &&
             status.opt_turbo !== PowerState.On && 
             !status.opt_sleepMode.startsWith(SleepModeState.Off);
    };

    const deviceStateModifier: DeviceStateModifierFn = (state: DeviceState, value: boolean): boolean => {
      if (value) {
        // Prevent enabling Sleep while Turbo is active
        if (state.turboMode === PowerState.On) {
          this.platform.log.info('[SleepSwitchAccessory] Cannot enable Sleep while Turbo is active. Request ignored.');
          return false;
        }
        if (state.power !== PowerState.On) {
          this.platform.log.info('[SleepSwitchAccessory] Cannot enable Sleep mode when AC is off. Request ignored.');
          return false;
        }
      }
      state.setSleepMode(value ? SleepModeState.On : SleepModeState.Off);
      return true; // Proceed with API call
    };

    super(
      platform,
      accessory,
      'Sleep',
      getStatusValue,
      deviceStateModifier,
    );
  }
}
