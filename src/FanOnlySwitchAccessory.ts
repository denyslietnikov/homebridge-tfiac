import { PlatformAccessory, CharacteristicGetCallback } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import AirConditionerAPI from './AirConditionerAPI.js';

export class FanOnlySwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    accessory.displayName = 'Fan Only Mode';
    const deviceAPI = new AirConditionerAPI(accessory.context.deviceConfig.ip, accessory.context.deviceConfig.port);
    super(
      platform,
      accessory,
      'Fan Only Mode', // Service Name
      'fanonly', // Service Subtype
      'operation_mode', // Status Key (Checks if current mode is 'fan')
      async (value: 'on' | 'off') => { // Custom API Set Method
        if (value === 'on') {
          await deviceAPI.setAirConditionerState('operation_mode', 'fan');
        } else {
          // Revert to Auto or Cool when turned off?
          await deviceAPI.setAirConditionerState('operation_mode', 'auto');
        }
      },
      'Fan Only Mode', // Log Prefix
    );
  }

  // Override handleGet to check if operation_mode is 'fan'
  protected handleGet(callback: CharacteristicGetCallback) {
    const currentValue = this.cachedStatus ? this.cachedStatus.operation_mode === 'fan' : false;
    this.platform.log.debug(`Get Fan Only Mode: Returning ${currentValue} (Cached Mode: ${this.cachedStatus?.operation_mode ?? 'null'})`);
    callback(null, currentValue);
  }

  // Override updateCachedStatus to update based on operation_mode
  protected async updateCachedStatus(): Promise<void> {
    if (this.isPolling) {
      return;
    }
    this.isPolling = true;
    this.platform.log.debug(`Updating Fan Only Mode status for ${this.accessory.displayName}...`);
    try {
      const status = await this.deviceAPI.updateState();
      const oldIsOn = this.cachedStatus ? this.cachedStatus.operation_mode === 'fan' : false;
      this.cachedStatus = status;
      const newIsOn = this.cachedStatus.operation_mode === 'fan';

      if (newIsOn !== oldIsOn) {
        this.platform.log.info(`Updating Fan Only Mode characteristic for ${this.accessory.displayName} to ${newIsOn}`);
        this.service.updateCharacteristic(this.platform.Characteristic.On, newIsOn);
      }
    } catch (error) {
      this.platform.log.error(`Error updating Fan Only Mode status for ${this.accessory.displayName}:`, error);
    } finally {
      this.isPolling = false;
    }
  }
}
