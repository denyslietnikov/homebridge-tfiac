import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import AirConditionerAPI from './AirConditionerAPI.js'; // Keep for type info if needed

export class TurboSwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    // Instantiate API locally for binding; BaseSwitchAccessory will create its own instance
    const deviceAPI = new AirConditionerAPI(accessory.context.deviceConfig.ip, accessory.context.deviceConfig.port);
    super(
      platform,
      accessory,
      'Turbo', // Service Name
      'turbo', // Service Subtype
      'opt_super', // Status Key
      deviceAPI.setTurboState.bind(deviceAPI), // API Set Method
      'Turbo', // Log Prefix
    );
  }

  // Specific overrides can go here if needed, otherwise Base class handles it.
}
