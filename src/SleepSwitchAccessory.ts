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
      if (!status) {
        return false;
      }
      // Sleep is active if AC is ON, Turbo is OFF, and the Sleep option (opt_sleep) is ON.
      return status.is_on === PowerState.On &&
             status.opt_turbo !== PowerState.On && // If opt_turbo is undefined, it's not considered On
             status.opt_sleep === PowerState.On;
    };

    const deviceStateModifier: DeviceStateModifierFn = (state: DeviceState, value: boolean): boolean => {
      if (value && state.power !== PowerState.On) {
        this.platform.log.info('[SleepSwitchAccessory] Cannot enable Sleep mode when AC is off. Request ignored.');
        // Prevent changing state if trying to turn ON Sleep while AC is OFF.
        // The switch in HomeKit might momentarily flip then revert if the actual state isn't changed.
        // To ensure UI consistency, we might need to throw an error here to signal HomeKit,
        // or rely on the next state update to correct the UI.
        // For now, just log and don't modify the state for this specific condition.
        return false; // Do not proceed with API call
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
