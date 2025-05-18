import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BooleanSwitchAccessory } from './BooleanSwitchAccessory.js';
import { OperationMode } from './enums.js';
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
        state.setOperationMode(value ? OperationMode.FanOnly : OperationMode.Auto);
        return true; // Always proceed with API call for FanOnly
      },
    );
  }
}
