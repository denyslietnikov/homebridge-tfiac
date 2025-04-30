import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import AirConditionerAPI from './AirConditionerAPI.js';

export class DrySwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    const serviceName = 'Dry';
    const deviceAPI = new AirConditionerAPI(accessory.context.deviceConfig.ip, accessory.context.deviceConfig.port);
    super(
      platform,
      accessory,
      serviceName, // Service Name
      'dry', // Service Subtype
      (status) => status.operation_mode === 'dehumi', // getStatusValue
      async (value) => { // setApiState
        await deviceAPI.setAirConditionerState('operation_mode', value ? 'dehumi' : 'auto');
      },
      'Dry', // Log Prefix
    );
    this.service.updateCharacteristic(platform.Characteristic.Name, serviceName);
  }
}
