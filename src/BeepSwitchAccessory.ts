import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import { PowerState } from './enums.js';

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
      (status) => status.opt_beep === PowerState.On,
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
