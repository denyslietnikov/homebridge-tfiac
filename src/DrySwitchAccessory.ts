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
      'Dry',
      'dry',
      (status) => status.operation_mode === OperationMode.Dry,
      async (value) => {
        const mode = value ? OperationMode.Dry : OperationMode.Auto;
        await this.cacheManager.api.setAirConditionerState('operation_mode', mode);
      },
      'Dry',
    );
  }
}
