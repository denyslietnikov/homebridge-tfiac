import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import AirConditionerAPI from './AirConditionerAPI.js'; // Keep for type info if needed

export class TurboSwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    const serviceName = 'Turbo';
    const deviceAPI = new AirConditionerAPI(accessory.context.deviceConfig.ip, accessory.context.deviceConfig.port);
    super(
      platform,
      accessory,
      serviceName, // Service Name
      'turbo', // Service Subtype
      (status) => status.opt_super === 'on', // getStatusValue
      async (value) => deviceAPI.setTurboState(value ? 'on' : 'off'), // setApiState
      'Turbo', // Log Prefix
    );
  }
}
