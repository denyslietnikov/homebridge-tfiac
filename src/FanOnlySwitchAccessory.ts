import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BooleanSwitchAccessory } from './BooleanSwitchAccessory.js';
import { OperationMode, PowerState } from './enums.js';
import { DeviceState } from './state/DeviceState.js';
import { AirConditionerStatus } from './AirConditionerAPI.js';

export class FanOnlySwitchAccessory extends BooleanSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    super(
      platform,
      accessory,
      'FanOnly',
      // getStatusValue
      (status: Partial<AirConditionerStatus>) => {
        if (!status || status.operation_mode === undefined) {
          return false;
        }
        return status.operation_mode === OperationMode.FanOnly;
      },
      // deviceStateModifier
      (state: DeviceState, value: boolean): boolean => {
        if (value) {
          // Turn on the AC and set to FanOnly mode
          state.setPower(PowerState.On);
          state.setOperationMode(OperationMode.FanOnly);
        } else {
          // Turn off FanOnly mode, revert to Auto
          state.setOperationMode(OperationMode.Auto);
        }
        return true; // Always proceed with API call for FanOnly
      },
    );
  }
}
