import { PlatformAccessory, CharacteristicSetCallback, CharacteristicValue } from 'homebridge';
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
  public handleGet(callback?: (error: Error | null, value?: boolean) => void): boolean {
    const value = this.cachedStatus ? 
      (this.cachedStatus.swing_mode === SwingMode.Horizontal || this.cachedStatus.swing_mode === SwingMode.Both) : 
      false;
    
    if (callback && typeof callback === 'function') {
      callback(null, value);
    }
    
    return value;
  }

  // Override handleSet for custom logic based on combined swing state
  protected async handleSet(value: CharacteristicValue, callback?: CharacteristicSetCallback): Promise<void> {
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
          const error = new Error('Could not retrieve status');
          this.platform.log.warn(`Could not retrieve status for ${this.accessory.displayName} to determine current swing state.`);
          if (callback && typeof callback === 'function') {
            callback(error);
            return;
          }
          throw error;
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
      if (this.service && newMode === SwingMode.Horizontal) {
        this.service.updateCharacteristic(this.onChar, requestedState);
      } else if (!this.service) {
        this.platform.log.warn(`Service not found for ${this.accessory.displayName} during set operation.`);
      }
      
      if (callback && typeof callback === 'function') {
        callback(null);
      }
    } catch (error) {
      this.platform.log.error(`Error setting Horizontal Swing for ${this.accessory.displayName}:`, error);
      if (callback && typeof callback === 'function') {
        callback(error as Error);
      } else {
        throw error; // Re-throw for promise-based API
      }
    }
  }
}
