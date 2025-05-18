import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BooleanSwitchAccessory } from './BooleanSwitchAccessory.js';

export class BeepSwitchAccessory extends BooleanSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    super(
      platform,
      accessory,
      'Beep',
      'opt_beep', // apiStatusKey
      'setBeepMode', // deviceStateSetterName
    );
  }
}
