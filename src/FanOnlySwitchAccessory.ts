import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import { OperationMode } from './enums.js';

export class FanOnlySwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    super(
      platform,
      accessory,
      'FanOnly',
      'fanonly',
      (status) => {
        // Add null/undefined check for the status object
        if (!status || status.operation_mode === undefined) {
          return false;
        }
        return status.operation_mode === OperationMode.FanOnly;
      },
      async (value) => {
        const mode = value ? OperationMode.FanOnly : OperationMode.Auto;
        const deviceState = this.cacheManager.getDeviceState();
        const desiredState = deviceState.clone();
        desiredState.setOperationMode(mode);
        await this.cacheManager.applyStateToDevice(desiredState);
      },
      'FanOnly',
    );
  }
}
