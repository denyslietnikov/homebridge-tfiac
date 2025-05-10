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
        // Get current device state
        const deviceState = this.cacheManager.getDeviceState();
        
        // Create a modified state for optimistic updates
        const modifiedState = deviceState.clone();
        
        if (value) {
          // Apply turbo mode with optimistic update
          modifiedState.setTurboMode(PowerState.On);
          
          // Turbo also affects sleep mode - they are mutually exclusive
          modifiedState.setSleepMode(SleepModeState.Off);
          
          this.platform.log.info('Enabling Turbo and disabling Sleep');
        } else {
          // Turn off turbo mode and set default fan speed
          modifiedState.setTurboMode(PowerState.Off);
          modifiedState.setFanSpeed(FanSpeed.Auto);
          
          this.platform.log.info('Disabling Turbo and setting fan speed to Auto');
        }
        
        // Apply the state changes through command queue
        await this.cacheManager.applyStateToDevice(modifiedState);
      },
      'Turbo',
    );
    
    // Debug logging is now centralized in platformAccessory.ts
  }
}
