import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import { OperationMode } from './enums.js';

export class DrySwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    super(
      platform,
      accessory,
      'Dry', // serviceName
      'dry', // subType
      (status) => {
        // Add null/undefined check for the status object
        if (!status || status.operation_mode === undefined) {
          return false;
        }
        return status.operation_mode === OperationMode.Dry;
      }, // isOn
      async (value) => { // setOn
        const mode = value ? OperationMode.Dry : OperationMode.Auto;
        // Use this.deviceState from BaseSwitchAccessory
        const desiredState = this.deviceState.clone();
        desiredState.setOperationMode(mode);
        await this.cacheManager.applyStateToDevice(desiredState);
      },
      'Dry', // characteristicName
    );
  }

  // Override to allow Dry switch to work regardless of AC power state
  protected shouldRespectMasterPowerState(): boolean {
    return false;
  }
}
