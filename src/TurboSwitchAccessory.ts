import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import { PowerState, FanSpeed, SleepModeState } from './enums.js';

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
      (status) => status.opt_turbo === PowerState.On,
      async (value) => {
        // Get current device state from CacheManager
        const deviceState = this.cacheManager.getDeviceState();
        
        // Create a modified state
        const modifiedState = deviceState.clone();
        
        if (value) { // Turbo ON
          this.platform.log.info('[TurboSwitchAccessory] Requesting Turbo ON');
          modifiedState.setTurboMode(PowerState.On);
          // If available, explicitly ensure sleep mode is off
          if (typeof modifiedState.setSleepMode === 'function') {
            modifiedState.setSleepMode(SleepModeState.Off);
          }
        } else { // Turbo OFF
          this.platform.log.info('[TurboSwitchAccessory] Requesting Turbo OFF');
          modifiedState.setTurboMode(PowerState.Off);
          // If available, explicitly reset fan speed to auto
          if (typeof modifiedState.setFanSpeed === 'function') {
            modifiedState.setFanSpeed(FanSpeed.Auto);
          }
        }
        
        // Apply the state changes through CacheManager.
        // CacheManager will diff and send the appropriate command (e.g., setOptionsCombined).
        // It also updates the central DeviceState, triggering listeners for UI updates.
        await this.cacheManager.applyStateToDevice(modifiedState);
      },
      'Turbo',
    );
  }
}
