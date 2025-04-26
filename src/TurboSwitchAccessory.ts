import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import AirConditionerAPI from './AirConditionerAPI.js'; // Keep for type info if needed

export class TurboSwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    // Don't change accessory.displayName!
    const deviceName = accessory.context.deviceConfig?.name || accessory.displayName || 'AC';
    const serviceName = `${deviceName} Turbo`;
    const deviceAPI = new AirConditionerAPI(accessory.context.deviceConfig.ip, accessory.context.deviceConfig.port);
    super(
      platform,
      accessory,
      serviceName, // Service Name
      'turbo', // Service Subtype
      'opt_super', // Status Key
      deviceAPI.setTurboState.bind(deviceAPI), // API Set Method
      'Turbo', // Log Prefix
    );
    this.service.setCharacteristic(platform.Characteristic.Name, serviceName);
  }
}
