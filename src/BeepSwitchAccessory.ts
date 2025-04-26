import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import AirConditionerAPI from './AirConditionerAPI.js';

export class BeepSwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    const deviceName = accessory.context.deviceConfig?.name || accessory.displayName || 'AC';
    const serviceName = `${deviceName} Beep`;
    const deviceAPI = new AirConditionerAPI(accessory.context.deviceConfig.ip, accessory.context.deviceConfig.port);
    super(
      platform,
      accessory,
      serviceName, // Service Name
      'beep', // Service Subtype
      'opt_beep', // Status Key
      deviceAPI.setBeepState.bind(deviceAPI), // API Set Method
      'Beep', // Log Prefix
    );
    this.service.setCharacteristic(platform.Characteristic.Name, serviceName);
  }
}
