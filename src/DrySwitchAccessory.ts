import { PlatformAccessory, CharacteristicGetCallback } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import AirConditionerAPI from './AirConditionerAPI.js';

export class DrySwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    const serviceName = 'Dry';
    const deviceAPI = new AirConditionerAPI(accessory.context.deviceConfig.ip, accessory.context.deviceConfig.port);
    super(
      platform,
      accessory,
      serviceName, // Service Name
      'dry', // Service Subtype
      'operation_mode', // Status Key
      async (value: 'on' | 'off') => {
        if (value === 'on') {
          await deviceAPI.setAirConditionerState('operation_mode', 'dehumi');
        } else {
          await deviceAPI.setAirConditionerState('operation_mode', 'auto');
        }
      },
      'Dry', // Log Prefix
    );
    this.service.updateCharacteristic(platform.Characteristic.Name, serviceName);
    this.service.updateCharacteristic(platform.Characteristic.ConfiguredName, serviceName);
  }

  // Override handleGet to check if operation_mode is 'dehumi'
  protected handleGet(callback: CharacteristicGetCallback) {
    const currentValue = this.cachedStatus ? this.cachedStatus.operation_mode === 'dehumi' : false;
    this.platform.log.debug(`Get Dry Mode: Returning ${currentValue} (Cached Mode: ${this.cachedStatus?.operation_mode ?? 'null'})`);
    callback(null, currentValue);
  }

  // Override updateCachedStatus to update based on operation_mode
  protected async updateCachedStatus(): Promise<void> {
    if (this.isPolling) {
      return;
    }
    this.isPolling = true;
    this.platform.log.debug(`Updating Dry Mode status for ${this.accessory.displayName}...`);
    try {
      const status = await this.deviceAPI.updateState();
      const oldIsOn = this.cachedStatus ? this.cachedStatus.operation_mode === 'dehumi' : false;
      this.cachedStatus = status;
      const newIsOn = this.cachedStatus.operation_mode === 'dehumi';

      if (newIsOn !== oldIsOn) {
        this.platform.log.info(`Updating Dry Mode characteristic for ${this.accessory.displayName} to ${newIsOn}`);
        this.service.updateCharacteristic(this.platform.Characteristic.On, newIsOn);
      }
    } catch (error) {
      this.platform.log.error(`Error updating Dry Mode status for ${this.accessory.displayName}:`, error);
    } finally {
      this.isPolling = false;
    }
  }
}
