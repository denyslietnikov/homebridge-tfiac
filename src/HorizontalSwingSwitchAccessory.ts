import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BooleanSwitchAccessory, DeviceStateModifierFn, GetStatusValueFromApiFn } from './BooleanSwitchAccessory.js';
import { SwingMode } from './enums.js';
import { DeviceState } from './state/DeviceState.js';
import { AirConditionerStatus } from './AirConditionerAPI.js';

export class HorizontalSwingSwitchAccessory extends BooleanSwitchAccessory {
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
  ) {
    const getStatusValue: GetStatusValueFromApiFn = (status: Partial<AirConditionerStatus>) => {
      if (!status || status.swing_mode === undefined) {
        return false;
      }
      return status.swing_mode === SwingMode.Horizontal || status.swing_mode === SwingMode.Both;
    };

    const deviceStateModifier: DeviceStateModifierFn = (state: DeviceState, value: boolean): boolean => {
      const currentMode = state.swingMode;
      let newMode: SwingMode;
      
      if (value) {
        // Turn horizontal swing on
        newMode = currentMode === SwingMode.Vertical ? SwingMode.Both : SwingMode.Horizontal;
      } else {
        // Turn horizontal swing off
        newMode = currentMode === SwingMode.Both ? SwingMode.Vertical : SwingMode.Off;
      }
      
      state.setSwingMode(newMode);
      return true; // Always proceed with API call for horizontal swing
    };

    super(
      platform,
      accessory,
      'Horizontal Swing',
      getStatusValue,
      deviceStateModifier,
    );
  }
}
