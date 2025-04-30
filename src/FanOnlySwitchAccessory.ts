import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import AirConditionerAPI from './AirConditionerAPI.js';

export class FanOnlySwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    const serviceName = 'Fan Only';
    const deviceAPI = new AirConditionerAPI(accessory.context.deviceConfig.ip, accessory.context.deviceConfig.port);
    super(
      platform,
      accessory,
      serviceName, // Service Name
      'fanonly', // Service Subtype
      (status) => status.operation_mode === 'fan_only', // getStatusValue
      async (value) => { // setApiState
        await deviceAPI.setAirConditionerState('operation_mode', value ? 'fan_only' : 'auto');
      },
      'Fan Only', // Log Prefix
    );
  }
}
