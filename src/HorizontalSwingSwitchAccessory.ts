import { PlatformAccessory, CharacteristicGetCallback, CharacteristicSetCallback, CharacteristicValue } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import { SwingMode } from './enums.js';

export class HorizontalSwingSwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    super(
      platform,
      accessory,
      'Horizontal Swing',
      'horizontal_swing',
      (status) => status.swing_mode === SwingMode.Horizontal || status.swing_mode === SwingMode.Both,
      async (value) => {
        const currentMode = this.cachedStatus?.swing_mode;
        let newMode: SwingMode;
        if (value) {
          // Turn horizontal swing on
          newMode = currentMode === SwingMode.Vertical ? SwingMode.Both : SwingMode.Horizontal;
        } else {
          // Turn horizontal swing off
          newMode = currentMode === SwingMode.Both ? SwingMode.Vertical : SwingMode.Off;
        }
        await this.cacheManager.api.setSwingMode(newMode);
      },
      'Horizontal Swing',
    );
  }

  // Override handleGet to check if swing_mode includes Horizontal
  protected handleGet(callback: CharacteristicGetCallback) {
    const mode = this.cachedStatus?.swing_mode;
    const currentValue = mode === SwingMode.Horizontal || mode === SwingMode.Both;
    this.platform.log.debug(`Get Horizontal Swing: Returning ${currentValue} (Cached Mode: ${mode ?? 'null'})`);
    callback(null, currentValue);
  }

  // Override handleSet for custom logic based on combined swing state
  protected async handleSet(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    const requestedState = value as boolean;
    this.platform.log.info(`Set Horizontal Swing: Received request to turn ${requestedState ? 'on' : 'off'} for ${this.accessory.displayName}`);

    try {
      let currentVerticalOn = false;
      const currentCachedMode = this.cachedStatus?.swing_mode;

      if (currentCachedMode) {
        currentVerticalOn = currentCachedMode === SwingMode.Vertical || currentCachedMode === SwingMode.Both;
        this.platform.log.debug(`Using cached vertical swing state: ${currentVerticalOn}`);
      } else {
        this.platform.log.debug('Fetching current status to determine vertical swing state...');
        const currentStatus = await this.cacheManager.getStatus();
        if (!currentStatus) {
          this.platform.log.warn(`Could not retrieve status for ${this.accessory.displayName} to determine current swing state.`);
          callback(new Error('Could not retrieve status'));
          return;
        }
        this.cachedStatus = currentStatus;
        currentVerticalOn = currentStatus?.swing_mode === SwingMode.Vertical || currentStatus?.swing_mode === SwingMode.Both;
        this.platform.log.debug(`Fetched vertical swing state: ${currentVerticalOn}`);
      }

      let newMode: SwingMode;
      if (requestedState) {
        newMode = currentVerticalOn ? SwingMode.Both : SwingMode.Horizontal;
      } else {
        newMode = currentVerticalOn ? SwingMode.Vertical : SwingMode.Off;
      }

      this.platform.log.info(`Setting combined swing mode to ${newMode} for ${this.accessory.displayName}`);
      await this.cacheManager.api.setSwingMode(newMode);

      if (this.cachedStatus) {
        this.cachedStatus.swing_mode = newMode;
      }
      this.service.updateCharacteristic('On', requestedState);
      callback(null);

    } catch (error) {
      this.platform.log.error(`Error setting Horizontal Swing for ${this.accessory.displayName}:`, error);
      callback(error as Error);
    }
  }

  // Override updateCachedStatus to update based on swing_mode
  protected async updateCachedStatus(): Promise<void> {
    this.platform.log.debug(`Updating Horizontal Swing status for ${this.accessory.displayName}...`);
    try {
      const status = await this.cacheManager.getStatus();
      if (!status) {
        this.platform.log.warn(`Received null status for ${this.logPrefix} on ${this.accessory.displayName}. Skipping update.`);
        return;
      }
      const oldMode = this.cachedStatus?.swing_mode;
      this.cachedStatus = status;
      const newMode = status?.swing_mode;

      if (newMode !== oldMode) {
        const newIsOn = newMode === SwingMode.Horizontal || newMode === SwingMode.Both;
        this.platform.log.info(`Updating Horizontal Swing characteristic for ${this.accessory.displayName} to ${newIsOn}`);
        this.service.updateCharacteristic('On', newIsOn);
      }
    } catch (error) {
      this.platform.log.error(`Error updating Horizontal Swing status for ${this.accessory.displayName}:`, error);
    }
  }
}
