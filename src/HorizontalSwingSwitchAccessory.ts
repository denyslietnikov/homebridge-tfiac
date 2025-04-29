import { PlatformAccessory, CharacteristicGetCallback, CharacteristicSetCallback, CharacteristicValue } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';

export class HorizontalSwingSwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    const serviceName = 'Horizontal Swing';
    super(
      platform,
      accessory,
      serviceName, // Service Name
      'horizontalswing', // Service Subtype
      (status) => status.swing_mode === 'Horizontal' || status.swing_mode === 'Both', // getStatusValue
      // Provide the actual API call for setting state here
      async (value: boolean) => {
        // This basic implementation might need adjustment based on handleSet logic
        const currentVerticalOn = this.cachedStatus?.swing_mode === 'Vertical' || this.cachedStatus?.swing_mode === 'Both';
        let newMode: 'Off' | 'Vertical' | 'Horizontal' | 'Both';
        if (value) { // Turning Horizontal ON
          newMode = currentVerticalOn ? 'Both' : 'Horizontal';
        } else { // Turning Horizontal OFF
          newMode = currentVerticalOn ? 'Vertical' : 'Off';
        }
        await this.cacheManager.api.setSwingMode(newMode);
      },
      'Horizontal Swing', // Log Prefix
    );
    this.service.updateCharacteristic(platform.Characteristic.Name, serviceName);
  }

  // Override handleGet to check if swing_mode includes Horizontal
  protected handleGet(callback: CharacteristicGetCallback) {
    const mode = this.cachedStatus?.swing_mode;
    const currentValue = mode === 'Horizontal' || mode === 'Both';
    this.platform.log.debug(`Get Horizontal Swing: Returning ${currentValue} (Cached Mode: ${mode ?? 'null'})`);
    callback(null, currentValue);
  }

  // Override handleSet for custom logic based on combined swing state
  protected async handleSet(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    const requestedState = value as boolean;
    this.platform.log.info(`Set Horizontal Swing: Received request to turn ${requestedState ? 'on' : 'off'} for ${this.accessory.displayName}`);

    try {
      // Need to read current vertical state to set combined mode
      // Use cached status if available, otherwise fetch fresh status
      let currentVerticalOn = false;
      const currentCachedMode = this.cachedStatus?.swing_mode;

      if (currentCachedMode) {
        currentVerticalOn = currentCachedMode === 'Vertical' || currentCachedMode === 'Both';
        this.platform.log.debug(`Using cached vertical swing state: ${currentVerticalOn}`);
      } else {
        this.platform.log.debug('Fetching current status to determine vertical swing state...');
        // Use cacheManager to get status
        const currentStatus = await this.cacheManager.getStatus(); // Removed 'true' argument
        if (!currentStatus) {
          this.platform.log.warn(`Could not retrieve status for ${this.accessory.displayName} to determine current swing state.`);
          callback(new Error('Could not retrieve status'));
          return;
        }
        this.cachedStatus = currentStatus; // Update cache
        currentVerticalOn = currentStatus?.swing_mode === 'Vertical' || currentStatus?.swing_mode === 'Both';
        this.platform.log.debug(`Fetched vertical swing state: ${currentVerticalOn}`);
      }

      let newMode: 'Off' | 'Vertical' | 'Horizontal' | 'Both';
      if (requestedState) { // Turning Horizontal ON
        newMode = currentVerticalOn ? 'Both' : 'Horizontal';
      } else { // Turning Horizontal OFF
        newMode = currentVerticalOn ? 'Vertical' : 'Off';
      }

      this.platform.log.info(`Setting combined swing mode to ${newMode} for ${this.accessory.displayName}`);
      // Use cacheManager's API instance
      await this.cacheManager.api.setSwingMode(newMode);

      // Optimistically update cache and characteristic
      if (this.cachedStatus) {
        this.cachedStatus.swing_mode = newMode;
      }
      this.service.updateCharacteristic(this.platform.Characteristic.On, requestedState);
      callback(null);

    } catch (error) {
      this.platform.log.error(`Error setting Horizontal Swing for ${this.accessory.displayName}:`, error);
      callback(error as Error);
    }
  }

  // Override updateCachedStatus to update based on swing_mode
  protected async updateCachedStatus(): Promise<void> {
    // Removed isPolling check as BaseSwitchAccessory handles polling loop
    this.platform.log.debug(`Updating Horizontal Swing status for ${this.accessory.displayName}...`);
    try {
      // Use cacheManager to get status
      const status = await this.cacheManager.getStatus(); // Removed 'true' argument, rely on CacheManager TTL
      if (!status) {
        this.platform.log.warn(`Received null status for ${this.logPrefix} on ${this.accessory.displayName}. Skipping update.`);
        return;
      }
      const oldMode = this.cachedStatus?.swing_mode;
      this.cachedStatus = status;
      // Add null check for status
      const newMode = status?.swing_mode;

      if (newMode !== oldMode) {
        const newIsOn = newMode === 'Horizontal' || newMode === 'Both';
        this.platform.log.info(`Updating Horizontal Swing characteristic for ${this.accessory.displayName} to ${newIsOn}`);
        this.service.updateCharacteristic(this.platform.Characteristic.On, newIsOn);
      }
    } catch (error) {
      this.platform.log.error(`Error updating Horizontal Swing status for ${this.accessory.displayName}:`, error);
    } 
    // Removed finally block with isPolling = false
  }
}
