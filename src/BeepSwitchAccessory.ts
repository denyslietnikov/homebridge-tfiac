import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import { PowerState } from './enums.js';
import { DeviceState } from './state/DeviceState.js';

export class BeepSwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    super(
      platform,
      accessory,
      'Beep',
      'beep',
      (status) => {
        // Check if we received a DeviceState object
        if (status instanceof DeviceState) {
          // Convert DeviceState to API status format
          status = status.toApiStatus();
        }
        
        // Add null/undefined check for the status object
        if (!status || status.opt_beep === undefined) {
          return false;
        }
        return status.opt_beep === PowerState.On;
      },
      async (value) => {
        const state = value ? PowerState.On : PowerState.Off;
        
        // Get device state
        const deviceState = this.cacheManager.getDeviceState();
        
        // Create a modified state for optimistic updates
        const modifiedState = deviceState.clone();
        modifiedState.setBeepMode(state);
        
        // Apply the state changes through command queue
        await this.cacheManager.applyStateToDevice(modifiedState);
      },
      'Beep',
    );
  }
}
