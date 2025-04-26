import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import AirConditionerAPI from './AirConditionerAPI.js';

export class EcoSwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    const serviceName = 'Eco';
    const deviceAPI = new AirConditionerAPI(accessory.context.deviceConfig.ip, accessory.context.deviceConfig.port);
    super(
      platform,
      accessory,
      serviceName, // Service Name
      'eco', // Service Subtype
      'opt_eco', // Status Key
      deviceAPI.setEcoState.bind(deviceAPI), // API Set Method
      'Eco', // Log Prefix
    );
    this.service.updateCharacteristic(platform.Characteristic.Name, serviceName);
    this.service.updateCharacteristic(platform.Characteristic.ConfiguredName, serviceName);
  }
}
