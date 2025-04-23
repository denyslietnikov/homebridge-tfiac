import { PlatformAccessory, CharacteristicGetCallback, CharacteristicSetCallback, CharacteristicValue } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';

export class HorizontalSwingSwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    super(
      platform,
      accessory,
      'Horizontal Swing', // Service Name
      'horizontalswing', // Service Subtype
      'swing_mode', // Status Key (Checks if mode includes Horizontal)
      // Custom API Set Method provided via override below
      async () => { /* No-op, handled by override */ },
      'Horizontal Swing', // Log Prefix
    );
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
      if (this.cachedStatus?.swing_mode) {
        currentVerticalOn = this.cachedStatus.swing_mode === 'Vertical' || this.cachedStatus.swing_mode === 'Both';
        this.platform.log.debug(`Using cached vertical swing state: ${currentVerticalOn}`);
      } else {
        this.platform.log.debug('Fetching current status to determine vertical swing state...');
        const currentStatus = await this.deviceAPI.updateState();
        this.cachedStatus = currentStatus; // Update cache
        currentVerticalOn = currentStatus.swing_mode === 'Vertical' || currentStatus.swing_mode === 'Both';
        this.platform.log.debug(`Fetched vertical swing state: ${currentVerticalOn}`);
      }


      let newMode: 'Off' | 'Vertical' | 'Horizontal' | 'Both';
      if (requestedState) { // Turning Horizontal ON
        newMode = currentVerticalOn ? 'Both' : 'Horizontal';
      } else { // Turning Horizontal OFF
        newMode = currentVerticalOn ? 'Vertical' : 'Off';
      }

      this.platform.log.info(`Setting combined swing mode to ${newMode} for ${this.accessory.displayName}`);
      await this.deviceAPI.setSwingMode(newMode);

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
    if (this.isPolling) {
      return;
    }
    this.isPolling = true;
    this.platform.log.debug(`Updating Horizontal Swing status for ${this.accessory.displayName}...`);
    try {
      const status = await this.deviceAPI.updateState();
      const oldMode = this.cachedStatus?.swing_mode;
      this.cachedStatus = status;
      const newMode = this.cachedStatus.swing_mode;

      if (newMode !== oldMode) {
        const newIsOn = newMode === 'Horizontal' || newMode === 'Both';
        this.platform.log.info(`Updating Horizontal Swing characteristic for ${this.accessory.displayName} to ${newIsOn}`);
        this.service.updateCharacteristic(this.platform.Characteristic.On, newIsOn);
      }
    } catch (error) {
      this.platform.log.error(`Error updating Horizontal Swing status for ${this.accessory.displayName}:`, error);
    } finally {
      this.isPolling = false;
    }
  }
}
