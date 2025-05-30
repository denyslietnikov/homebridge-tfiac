// src/BooleanSwitchAccessory.ts
import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { BaseSwitchAccessory } from './BaseSwitchAccessory.js';
import { DeviceState } from './state/DeviceState.js';
import { AirConditionerStatus } from './AirConditionerAPI.js';
import { PowerState, SUBTYPES } from './enums.js'; // Added PowerState and SUBTYPES import

// This function will receive Partial<AirConditionerStatus> because BaseSwitchAccessory ensures this.
export type GetStatusValueFromApiFn = (status: Partial<AirConditionerStatus>) => boolean;

// This function modifies a DeviceState instance based on the boolean value from the switch.
// It now returns a boolean: true if the API call should proceed, false otherwise.
export type DeviceStateModifierFn = (state: DeviceState, value: boolean) => boolean;

/**
 * Maps display names to consistent service subtypes
 */
function getServiceSubtype(displayName: string): string {
  const subtypeMap: Record<string, string> = {
    'Display': SUBTYPES.display,
    'Sleep': SUBTYPES.sleep,
    'Dry': SUBTYPES.dry,
    'FanOnly': SUBTYPES.fanOnly,
    'Turbo': SUBTYPES.turbo,
    'Eco': SUBTYPES.eco,
    'HorizontalSwing': SUBTYPES.horizontalSwing,
    'Beep': SUBTYPES.beep,
  };
  
  return subtypeMap[displayName] || displayName.toLowerCase().replace(/\s+/g, '').replace(/-/g, '');
}

export class BooleanSwitchAccessory extends BaseSwitchAccessory {
  // Overload signatures
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
    displayName: string,
    apiStatusKey: keyof AirConditionerStatus, // e.g., 'opt_display'
    deviceStateSetterName: keyof DeviceState, // e.g., 'setDisplayMode'
  );
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
    displayName: string,
    getStatusValue: GetStatusValueFromApiFn,
    deviceStateModifier: DeviceStateModifierFn,
  );

  // Implementation
  constructor(
    platform: TfiacPlatform,
    accessory: PlatformAccessory,
    displayName: string,
    arg4: keyof AirConditionerStatus | GetStatusValueFromApiFn,
    arg5: keyof DeviceState | DeviceStateModifierFn,
  ) {
    const serviceSubtype = getServiceSubtype(displayName);
    let getStatusFunc: GetStatusValueFromApiFn;
    let modifierFunc: DeviceStateModifierFn;

    if (typeof arg4 === 'string' && typeof arg5 === 'string') {
      const apiStatusKey = arg4 as keyof AirConditionerStatus;
      const setterName = arg5 as keyof DeviceState;

      getStatusFunc = (status: Partial<AirConditionerStatus>) => {
        if (Object.prototype.hasOwnProperty.call(status, apiStatusKey)) {
          return status[apiStatusKey] === PowerState.On;
        }
        // platform.log.warn(`[${displayName}] API status key "${apiStatusKey}" not found in status object.`);
        return false;
      };
      modifierFunc = (state: DeviceState, value: boolean): boolean => {
        const setter = state[setterName];
        if (typeof setter === 'function') {
          const powerState = value ? PowerState.On : PowerState.Off;
          (setter as (mode: PowerState) => void).call(state, powerState);
          return true; // Proceed with API call
        } else {
          platform.log.error(
            `[${displayName}] Invalid DeviceState setter method name: ${String(setterName)} on DeviceState object.`,
          );
          return false; // Do not proceed if setter is invalid
        }
      };
    } else if (typeof arg4 === 'function' && typeof arg5 === 'function') {
      getStatusFunc = arg4 as GetStatusValueFromApiFn;
      modifierFunc = arg5 as DeviceStateModifierFn;
    } else {
      const arg4Type = typeof arg4;
      const arg5Type = typeof arg5;
      platform.log.error(
        `[${displayName}] Invalid arguments for BooleanSwitchAccessory constructor. ` +
        `Arg4 type: ${arg4Type}, Arg5 type: ${arg5Type}. ` +
        'Expected (string, string) or (function, function).',
      );
      throw new Error(`[${displayName}] Invalid arguments for BooleanSwitchAccessory constructor.`);
    }

    super(
      platform,
      accessory,
      displayName, // serviceName for BaseSwitchAccessory
      serviceSubtype, // serviceSubtype for BaseSwitchAccessory
      getStatusFunc, // getStatusValue fn for BaseSwitchAccessory
      async (value: boolean) => { // setApiState fn for BaseSwitchAccessory
        const deviceState = this.cacheManager.getDeviceState();
        
        const modifiedState = deviceState.clone();
        
        const shouldProceed = modifierFunc(modifiedState, value);
        
        if (shouldProceed) {
          await this.cacheManager.applyStateToDevice(modifiedState);
        } else {
          // Throw an error to prevent HomeKit UI from showing the switch as activated
          throw new Error('Operation rejected by device state modifier');
        }
      },
      displayName, // logPrefix for BaseSwitchAccessory
    );
  }
}
