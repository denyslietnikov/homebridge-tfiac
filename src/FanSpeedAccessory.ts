import {
  PlatformAccessory,
  Service,
  CharacteristicValue,
} from 'homebridge';
import { TfiacPlatform } from './platform.js';
import AirConditionerAPI, { AirConditionerStatus } from './AirConditionerAPI.js';
import { TfiacDeviceConfig } from './settings.js';
import CacheManager from './CacheManager.js';
import { PowerState, FanSpeed, FanSpeedPercentMap, SleepModeState } from './enums.js';

export class FanSpeedAccessory {
  private service: Service;
  private deviceAPI: AirConditionerAPI;
  private cacheManager: CacheManager;
  private statusListener: (status: AirConditionerStatus | null) => void;
  private userSetFanMode: FanSpeed | null = null; // Track the user's manually set fan mode
  private lastUpdateTime: number = 0; // Track when the user last set the fan speed

  constructor(
    private readonly platform: TfiacPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const serviceName = 'Fan Speed';
    
    const deviceConfig = this.accessory.context.deviceConfig as TfiacDeviceConfig;
    this.cacheManager = CacheManager.getInstance(deviceConfig);
    this.deviceAPI = this.cacheManager.api;

    // Create or retrieve the Fan service
    this.service =
      this.accessory.getServiceById(this.platform.Service.Fanv2, 'fan_speed') ||
      this.accessory.addService(this.platform.Service.Fanv2, serviceName, 'fan_speed');
    
    this.service.setCharacteristic(this.platform.Characteristic.ConfiguredName, serviceName);

    // Subscribe to centralized status updates
    this.statusListener = this.updateStatus.bind(this);
    if (typeof this.cacheManager.api.on === 'function') {
      this.cacheManager.api.on('status', this.statusListener);
    }

    // Get the Active characteristic
    const activeChar = this.service.getCharacteristic(this.platform.Characteristic.Active);
    
    // Use modern methods if available, fallback to legacy methods for compatibility
    if (typeof activeChar.onGet === 'function' && typeof activeChar.onSet === 'function') {
      activeChar.onGet(this.handleActiveGet.bind(this));
      activeChar.onSet(this.handleActiveSet.bind(this));
    } else {
      activeChar
        .on('get', (callback) => this.handleActiveGet(callback))
        .on('set', (value, callback) => this.handleActiveSet(value, callback));
    }

    // Get the RotationSpeed characteristic
    const rotationSpeedChar = this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed);
    
    // Use modern methods if available, fallback to legacy methods for compatibility
    if (typeof rotationSpeedChar.onGet === 'function' && typeof rotationSpeedChar.onSet === 'function') {
      rotationSpeedChar.onGet(this.handleGet.bind(this));
      rotationSpeedChar.onSet(this.handleSet.bind(this));
    } else {
      rotationSpeedChar
        .on('get', (callback) => this.handleGet(callback))
        .on('set', (value, callback) => this.handleSet(value, callback));
    }
  }

  /**
   * Update fan speed based on centralized status
   */
  private updateStatus(status: AirConditionerStatus | null): void {
    // First check if AC is on
    const isAcOn = status && status.is_on === PowerState.On;
    
    // Update Active state - the fan speed accessory should be inactive when AC is off
    const activeValue = isAcOn
      ? this.platform.Characteristic.Active.ACTIVE
      : this.platform.Characteristic.Active.INACTIVE;
    this.service.updateCharacteristic(
      this.platform.Characteristic.Active,
      activeValue,
    );

    // Update RotationSpeed - only show accurate speed when AC is on
    let value: number;
    if (!isAcOn) {
      // When AC is off, set the rotation speed to 0
      value = 0;
      this.userSetFanMode = null; // Reset user settings when AC is off
    } else if (status && status.opt_turbo === PowerState.On) {
      value = FanSpeedPercentMap[FanSpeed.Turbo];
    } else if (status && typeof status.fan_mode === 'string') {
      // If user manually set the fan speed recently (within 30 seconds), preserve that setting
      // instead of using what the air conditioner reports
      const currentTime = Date.now();
      const userSetRecently = (currentTime - this.lastUpdateTime) < 30000; // 30 seconds threshold
      
      if (this.userSetFanMode !== null && userSetRecently) {
        // Use the user's setting instead of the one from the AC
        value = FanSpeedPercentMap[this.userSetFanMode] ?? FanSpeedPercentMap[FanSpeed.Auto];
        this.platform.log.debug(`Using user-set fan mode: ${this.userSetFanMode} (${value}%) instead of reported: ${status.fan_mode}`);
      } else {
        // Otherwise use what the AC reports
        value = FanSpeedPercentMap[status.fan_mode as FanSpeed] ?? FanSpeedPercentMap[FanSpeed.Auto];
        
        // If the value differs from our last setting, log it for debugging
        if (this.userSetFanMode !== null) {
          this.platform.log.debug(`Fan mode changed from user setting: was ${this.userSetFanMode}, now ${status.fan_mode} (${value}%)`);
          this.userSetFanMode = null; // Clear the user setting since it's been overridden
        }
      }
    } else {
      value = FanSpeedPercentMap[FanSpeed.Auto];
    }
    
    this.service.updateCharacteristic(
      this.platform.Characteristic.RotationSpeed,
      value,
    );
  }

  private handleActiveGet(callback?: (err: Error | null, value?: number) => void): number | Promise<number> {
    // Get the current status directly from the cache manager
    const status = this.cacheManager.getLastStatus();
    
    // Only return active if AC is on
    const isActive = status && status.is_on === PowerState.On
      ? this.platform.Characteristic.Active.ACTIVE
      : this.platform.Characteristic.Active.INACTIVE;
    
    if (callback && typeof callback === 'function') {
      callback(null, isActive);
      return isActive;
    }
    
    return Promise.resolve(isActive);
  }

  private async handleActiveSet(value: CharacteristicValue, callback?: (err?: Error | null) => void): Promise<void> {
    try {
      this.platform.log.debug(`Fan accessory active set: ${value}`);
      
      if (value === this.platform.Characteristic.Active.ACTIVE) {
        // Turn on AC with current settings
        await this.deviceAPI.turnOn();
      } else {
        // Turn off AC
        await this.deviceAPI.turnOff();
      }
      
      // Don't clear cache manually - let the centralized status update handle it
      
      if (callback && typeof callback === 'function') {
        callback(null);
      }
    } catch (err) {
      if (callback && typeof callback === 'function') {
        callback(err as Error);
      } else {
        throw err;
      }
    }
  }

  private handleGet(callback?: (err: Error | null, value?: number) => void): number | Promise<number> {
    // Get current AC status first
    const status = this.cacheManager.getLastStatus();
    const isAcOn = status && status.is_on === PowerState.On;
    
    // If AC is off, always return 0 rotation speed
    if (!isAcOn) {
      if (callback && typeof callback === 'function') {
        callback(null, 0);
        return 0;
      }
      return Promise.resolve(0);
    }
    
    // Otherwise, return the current rotation speed value
    const current = this.service.getCharacteristic(
      this.platform.Characteristic.RotationSpeed,
    ).value as number;
    
    if (callback && typeof callback === 'function') {
      callback(null, current ?? 50);
      return current ?? 50;
    }
    
    return Promise.resolve(current ?? 50);
  }

  private async handleSet(value: CharacteristicValue, callback?: (err?: Error | null) => void): Promise<void> {
    try {
      // Determine what fan mode the user is setting based on the percentage
      const fanMode = this.mapRotationSpeedToFanMode(value as number);
      
      // Store the user's choice and update the timestamp
      this.userSetFanMode = fanMode;
      this.lastUpdateTime = Date.now();
      
      this.platform.log.debug(`User set fan speed to ${value}%, mapped to mode: ${fanMode}`);
      
      // Send the fan mode string to the air conditioner instead of the raw percentage
      await this.deviceAPI.setFanSpeed(fanMode);
      
      // If fan speed is being set to Auto (0%), also turn off Sleep mode
      if (value === 0 || fanMode === FanSpeed.Auto) {
        this.platform.log.info('Fan speed set to Auto (0%), turning off Sleep mode');
        try {
          // Turn off sleep mode when setting fan to Auto
          await this.deviceAPI.setSleepState(SleepModeState.Off);
        } catch (sleepErr) {
          // Log but don't fail the operation if we can't turn off sleep mode
          this.platform.log.error('Failed to turn off Sleep mode:', sleepErr);
        }
      }
      
      // Don't clear cache manually - let the centralized status update handle it
      
      if (callback && typeof callback === 'function') {
        callback(null);
      }
    } catch (err) {
      if (callback && typeof callback === 'function') {
        callback(err as Error);
      } else {
        throw err;
      }
    }
  }

  /**
   * Convert rotation speed percentage to fan mode
   * @private
   */
  private mapRotationSpeedToFanMode(speed: number): FanSpeed {
    if (speed === 0) {
      return FanSpeed.Auto;  
    } else if (speed <= 25) {
      return FanSpeed.Low;
    } else if (speed <= 50) {
      return FanSpeed.Middle;
    } else if (speed <= 75) {
      return FanSpeed.High;
    } else if (speed > 75) {
      return FanSpeed.Turbo;
    }
    // Default case (should never happen with the conditions above, but needed for TypeScript)
    return FanSpeed.Auto;
  }

  /**
   * Unsubscribe from centralized status updates
   */
  public stopPolling(): void {
    if (typeof this.cacheManager.api.off === 'function') {
      this.cacheManager.api.off('status', this.statusListener);
    }
  }
}
