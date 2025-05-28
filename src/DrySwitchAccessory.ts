import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BooleanSwitchAccessory } from './BooleanSwitchAccessory.js';
import { OperationMode, PowerState } from './enums.js';
import { DeviceState } from './state/DeviceState.js';
import { AirConditionerStatus } from './AirConditionerAPI.js';

export class DrySwitchAccessory extends BooleanSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    super(
      platform,
      accessory,
      'Dry',
      // getStatusValue
      (status: Partial<AirConditionerStatus>) => {
        if (!status || status.operation_mode === undefined) {
          return false;
        }
        return status.operation_mode === OperationMode.Dry;
      },
      // deviceStateModifier
      (state: DeviceState, value: boolean): boolean => {
        if (value) {
          // Turn on the AC and set to Dry mode
          state.setPower(PowerState.On);
          state.setOperationMode(OperationMode.Dry);
        } else {
          // Turn off Dry mode, revert to Auto
          state.setOperationMode(OperationMode.Auto);
        }
        return true; // Always proceed with API call for Dry mode
      },
    );
  }

  // Override to allow Dry switch to work regardless of AC power state
  protected shouldRespectMasterPowerState(): boolean {
    return false;
  }
}
