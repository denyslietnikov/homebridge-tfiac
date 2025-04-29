import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import AirConditionerAPI from './AirConditionerAPI.js';

export class SleepSwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    const serviceName = 'Sleep';
    const deviceAPI = new AirConditionerAPI(accessory.context.deviceConfig.ip, accessory.context.deviceConfig.port);
    super(
      platform,
      accessory,
      serviceName, // Service Name
      'sleep', // Service Subtype
      (status) => typeof status.opt_sleepMode === 'string' && status.opt_sleepMode.startsWith('sleepMode'), // getStatusValue
      async (value) => deviceAPI.setSleepState(value ? 'on' : 'off'), // setApiState
      'Sleep', // Log Prefix
    );
    this.service.updateCharacteristic(platform.Characteristic.Name, serviceName);
  }
}
