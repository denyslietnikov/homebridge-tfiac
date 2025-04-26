import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import AirConditionerAPI from './AirConditionerAPI.js';

export class DisplaySwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    // Don't change accessory.displayName!
    const deviceName = accessory.context.deviceConfig?.name || accessory.displayName || 'AC';
    const serviceName = `${deviceName} Display`;
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
    this.service.setCharacteristic(platform.Characteristic.Name, serviceName);
  }
}
