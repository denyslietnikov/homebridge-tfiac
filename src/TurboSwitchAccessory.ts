import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import { PowerState, SleepModeState, FanSpeed } from './enums.js';
import { DeviceState } from './state/DeviceState.js';

export class TurboSwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    super(
      platform,
      accessory,
      'Turbo',
      'turbo',
      (status) => {
        // Check if we received a DeviceState object
        if (status instanceof DeviceState) {
          // Convert DeviceState to API status format
          status = status.toApiStatus();
        }
        
        // Add null/undefined check for the status object
        if (!status || status.opt_turbo === undefined) {
          return false;
        }
        return status.opt_turbo === PowerState.On;
      },
      async (value) => {
        // Get current device state from CacheManager
        const deviceState = this.cacheManager.getDeviceState();
        
        // Create a modified state
        const modifiedState = deviceState.clone();
        
        if (value) { // Turbo ON
          this.platform.log.info('[TurboSwitchAccessory] Requesting Turbo ON');
          modifiedState.setTurboMode(PowerState.On);
          // Turn off sleep mode when turbo is enabled
          modifiedState.setSleepMode(SleepModeState.Off);
        } else { // Turbo OFF
          this.platform.log.info('[TurboSwitchAccessory] Requesting Turbo OFF');
          modifiedState.setTurboMode(PowerState.Off);
          // Reset fan speed to Auto when turbo is disabled
          modifiedState.setFanSpeed(FanSpeed.Auto);
        }
        
        // Apply the state changes through CacheManager.
        // CacheManager will diff and send the appropriate command.
        // It also updates the central DeviceState, triggering listeners for UI updates.
        await this.cacheManager.applyStateToDevice(modifiedState);
      },
      'Turbo',
    );
  }
}
