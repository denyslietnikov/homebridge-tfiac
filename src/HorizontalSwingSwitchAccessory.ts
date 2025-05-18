import { PlatformAccessory, CharacteristicSetCallback, CharacteristicValue } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import { SwingMode } from './enums.js';
import { DeviceState } from './state/DeviceState.js';

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
      (status) => {
        // Check if we received a DeviceState object
        if (status instanceof DeviceState) {
          // Convert DeviceState to API status format
          status = status.toApiStatus();
        }
        
        // Add null/undefined check for the status object
        if (!status || status.swing_mode === undefined) {
          return false;
        }
        return status.swing_mode === SwingMode.Horizontal || status.swing_mode === SwingMode.Both;
      }, // status here is Partial<AirConditionerStatus>
      async (value) => {
        const modifiedState = this.deviceState.clone();
        const currentMode = modifiedState.swingMode;
        let newMode: SwingMode;
        if (value) {
          // Turn horizontal swing on
          newMode = currentMode === SwingMode.Vertical ? SwingMode.Both : SwingMode.Horizontal;
        } else {
          // Turn horizontal swing off
          newMode = currentMode === SwingMode.Both ? SwingMode.Vertical : SwingMode.Off;
        }
        modifiedState.setSwingMode(newMode);
        await this.cacheManager.applyStateToDevice(modifiedState);
      },
      'Horizontal Swing',
    );
  }

  // Override handleGet to check if swing_mode includes Horizontal
  public handleGet(callback?: (error: Error | null, value?: boolean) => void): boolean {
    const value = this.deviceState ? 
      (this.deviceState.swingMode === SwingMode.Horizontal || this.deviceState.swingMode === SwingMode.Both) : 
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
      const currentDeviceSwingMode = this.deviceState.swingMode; 

      if (currentDeviceSwingMode) {
        currentVerticalOn = currentDeviceSwingMode === SwingMode.Vertical || currentDeviceSwingMode === SwingMode.Both;
        this.platform.log.debug(`Using cached vertical swing state from DeviceState: ${currentVerticalOn}`);
      } else {
        this.platform.log.debug('DeviceState has no swingMode, fetching current status from device...');
        const currentStatusFromAPI = await this.cacheManager.getStatus(); 
        if (!currentStatusFromAPI) {
          const error = new Error('Could not retrieve status');
          this.platform.log.warn(`Could not retrieve status for ${this.accessory.displayName} to determine current swing state.`);
          if (callback && typeof callback === 'function') {
            callback(error);
            return;
          }
          throw error;
        }
        currentVerticalOn = currentStatusFromAPI.swingMode === SwingMode.Vertical || 
                            currentStatusFromAPI.swingMode === SwingMode.Both;
        this.platform.log.debug(`Fetched vertical swing state from API (via DeviceState): ${currentVerticalOn}`);
      }

      let newMode: SwingMode;
      if (requestedState) {
        newMode = currentVerticalOn ? SwingMode.Both : SwingMode.Horizontal;
      } else {
        newMode = currentVerticalOn ? SwingMode.Vertical : SwingMode.Off;
      }

      this.platform.log.info(`Setting combined swing mode to ${newMode} for ${this.accessory.displayName}`);
      
      const modifiedState = this.deviceState.clone();
      modifiedState.setSwingMode(newMode);
      await this.cacheManager.applyStateToDevice(modifiedState);

      // Removed manual characteristic update and local cache update
      // These will be handled by BaseSwitchAccessory's stateChanged listener

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
