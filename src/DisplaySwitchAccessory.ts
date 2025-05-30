import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BooleanSwitchAccessory } from './BooleanSwitchAccessory.js';

/**
 * Accessory for controlling the display (light) of the air conditioner.
 * Extends BooleanSwitchAccessory to provide a simple On/Off switch.
 */
export class DisplaySwitchAccessory extends BooleanSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    super(
      platform,
      accessory,
      'Display',
      'opt_display', // apiStatusKey
      'setDisplayMode', // deviceStateSetterName
    );
  }
}