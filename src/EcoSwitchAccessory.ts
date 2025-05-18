import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BooleanSwitchAccessory } from './BooleanSwitchAccessory.js';

export class EcoSwitchAccessory extends BooleanSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    super(
      platform,
      accessory,
      'Eco',
      'opt_eco', // apiStatusKey
      'setEcoMode', // deviceStateSetterName
    );
  }

  // The setEcoState method is no longer needed as its functionality is covered by the base class
}
