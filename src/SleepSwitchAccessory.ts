import { PlatformAccessory, CharacteristicGetCallback } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import AirConditionerAPI from './AirConditionerAPI.js';

export class SleepSwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    const deviceAPI = new AirConditionerAPI(accessory.context.deviceConfig.ip, accessory.context.deviceConfig.port);
    super(
      platform,
      accessory,
      'Sleep Mode', // Service Name
      'sleep', // Service Subtype
      'opt_sleepMode', // Status Key - NOTE: API might need adjustment if value isn't 'on'/'off'
      deviceAPI.setSleepState.bind(deviceAPI), // API Set Method
      'Sleep', // Log Prefix
    );
  }

  // Override handleGet because opt_sleepMode uses different values (e.g., 'sleepMode1:...')
  protected handleGet(callback: CharacteristicGetCallback) {
    const rawValue = this.cachedStatus ? this.cachedStatus.opt_sleepMode : undefined;
    // Check if the raw value indicates sleep mode is active (adjust condition if needed)
    const currentValue = typeof rawValue === 'string' && rawValue.startsWith('sleepMode');
    this.platform.log.debug(`Get Sleep: Returning ${currentValue} (Cached: ${rawValue ?? 'null'})`);
    callback(null, currentValue);
  }

  // Override updateCachedStatus because opt_sleepMode uses different values
  protected async updateCachedStatus(): Promise<void> {
    if (this.isPolling) {
      return;
    }
    this.isPolling = true;
    this.platform.log.debug(`Updating Sleep status for ${this.accessory.displayName}...`);
    try {
      const status = await this.deviceAPI.updateState();
      const oldRawValue = this.cachedStatus?.opt_sleepMode;
      this.cachedStatus = status;
      const newRawValue = this.cachedStatus.opt_sleepMode;

      if (newRawValue !== oldRawValue) {
        const newIsOn = typeof newRawValue === 'string' && newRawValue.startsWith('sleepMode');
        this.platform.log.info(`Updating Sleep characteristic for ${this.accessory.displayName} to ${newIsOn}`);
        this.service.updateCharacteristic(this.platform.Characteristic.On, newIsOn);
      }
    } catch (error) {
      this.platform.log.error(`Error updating Sleep status for ${this.accessory.displayName}:`, error);
    } finally {
      this.isPolling = false;
    }
  }
}
