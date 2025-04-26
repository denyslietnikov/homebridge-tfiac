import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import AirConditionerAPI from './AirConditionerAPI.js';

export class DisplaySwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    const serviceName = 'Display';
    const deviceAPI = new AirConditionerAPI(accessory.context.deviceConfig.ip, accessory.context.deviceConfig.port);
    super(
      platform,
      accessory,
      serviceName, // Service Name
      'display', // Service Subtype
      'opt_display', // Status Key
      deviceAPI.setDisplayState.bind(deviceAPI), // API Set Method
      'Display', // Log Prefix
    );
    this.service.updateCharacteristic(platform.Characteristic.Name, serviceName);
    this.service.updateCharacteristic(platform.Characteristic.ConfiguredName, serviceName);
  }
}
