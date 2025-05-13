import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import { PowerState } from './enums.js';

export class EcoSwitchAccessory extends BaseSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    super(
      platform,
      accessory,
      'Eco',
      'eco',
      (status) => status.opt_eco === PowerState.On,
      async (value) => {
        const state = value ? PowerState.On : PowerState.Off;
        
        // Get device state
        const deviceState = this.cacheManager.getDeviceState();
        
        // Create a modified state
        const modifiedState = deviceState.clone();
        modifiedState.setEcoMode(state);
        
        // Apply the state changes through command queue
        // This will trigger DeviceState update and subsequently the BaseSwitchAccessory listener
        await this.cacheManager.applyStateToDevice(modifiedState);
      },
      'Eco',
    );
  }

  public async setEcoState(value: boolean): Promise<void> {
    const state = value ? PowerState.On : PowerState.Off;
    
    // Get device state
    const deviceState = this.cacheManager.getDeviceState();
    
    // Create a modified state
    const modifiedState = deviceState.clone();
    modifiedState.setEcoMode(state);
    
    // Apply the state changes through command queue
    // This will trigger DeviceState update and subsequently the BaseSwitchAccessory listener
    await this.cacheManager.applyStateToDevice(modifiedState);
    
    // Removed manual UI update: if (this.service) { ... }
    // The characteristic update is now handled by the BaseSwitchAccessory's stateChanged listener.
  }
}
