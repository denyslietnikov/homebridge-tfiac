import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import AirConditionerAPI from './AirConditionerAPI.js';

export class EcoSwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    const deviceName = accessory.context.deviceConfig?.name || accessory.displayName || 'AC';
    const serviceName = `${deviceName} Eco`;
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
    this.service.setCharacteristic(platform.Characteristic.Name, serviceName);
  }
}
