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
        
        // Create a modified state for optimistic updates
        const modifiedState = deviceState.clone();
        modifiedState.setEcoMode(state);
        
        // Apply the state changes through command queue
        await this.cacheManager.applyStateToDevice(modifiedState);
      },
      'Eco',
    );
  }

  public async setEcoState(value: boolean): Promise<void> {
    const state = value ? PowerState.On : PowerState.Off;
    
    // Get device state
    const deviceState = this.cacheManager.getDeviceState();
    
    // Create a modified state for optimistic updates
    const modifiedState = deviceState.clone();
    modifiedState.setEcoMode(state);
    
    // Apply the state changes through command queue
    await this.cacheManager.applyStateToDevice(modifiedState);
    
    // Update the UI
    if (this.service) {
      this.service.updateCharacteristic(this.platform.Characteristic.On, value);
    }
  }
}
