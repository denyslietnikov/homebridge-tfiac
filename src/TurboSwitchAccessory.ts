import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import AirConditionerAPI from './AirConditionerAPI.js'; // Keep for type info if needed

export class TurboSwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    const deviceName = accessory.context.deviceConfig.name;
    const serviceName = `${deviceName} Turbo`; // Use device name
    const serviceSubtype = 'turbo'; // Keep subtype simple

    const deviceAPI = new AirConditionerAPI(accessory.context.deviceConfig.ip, accessory.context.deviceConfig.port);
    super(
      platform,
      accessory,
      serviceName, // Service Name
      serviceSubtype, // Service Subtype
      'opt_super', // Status Key
      deviceAPI.setTurboState.bind(deviceAPI), // API Set Method
      'Turbo', // Log Prefix
    );

    // The BaseSwitchAccessory constructor already handles getting/adding the service.
    // No need to re-assign this.service here.

    // Base class already sets the name, but we can ensure it here if needed
    // this.service.setCharacteristic(this.platform.Characteristic.Name, serviceName);
    // this.service.updateCharacteristic(platform.Characteristic.ConfiguredName, serviceName);
  }
}
