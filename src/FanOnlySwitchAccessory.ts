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
      'Fan Only',
      'fanonly',
      (status) => status.operation_mode === OperationMode.FanOnly,
      async (value) => {
        const mode = value ? OperationMode.FanOnly : OperationMode.Auto;
        await this.cacheManager.api.setAirConditionerState('operation_mode', mode);
      },
      'Fan Only',
    );
  }
}
