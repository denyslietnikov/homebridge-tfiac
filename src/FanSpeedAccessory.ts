import {
  PlatformAccessory,
  Service,
  CharacteristicValue,
} from 'homebridge';
import { TfiacPlatform } from './platform.js';
import AirConditionerAPI, { AirConditionerStatus } from './AirConditionerAPI.js';
import { TfiacDeviceConfig } from './settings.js';
import CacheManager from './CacheManager.js';
import { PowerState, FanSpeed, FanSpeedPercentMap } from './enums.js';

export class FanSpeedAccessory {
  private service: Service;
  private deviceAPI: AirConditionerAPI;
  private cacheManager: CacheManager;
  private statusListener: (status: AirConditionerStatus | null) => void;

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
    // Update Active state
    const activeValue = status && status.is_on === PowerState.On
      ? this.platform.Characteristic.Active.ACTIVE
      : this.platform.Characteristic.Active.INACTIVE;
    this.service.updateCharacteristic(
      this.platform.Characteristic.Active,
      activeValue,
    );

    // Update RotationSpeed
    const value =
      status && typeof status.fan_mode === 'string'
        ? FanSpeedPercentMap[status.fan_mode as FanSpeed] ?? 50
        : 50;
    this.service.updateCharacteristic(
      this.platform.Characteristic.RotationSpeed,
      value,
    );
  }

  private handleActiveGet(callback?: (err: Error | null, value?: number) => void): number | Promise<number> {
    // Read current characteristic value
    const current = this.service.getCharacteristic(
      this.platform.Characteristic.Active,
    ).value as number;
    
    if (callback && typeof callback === 'function') {
      callback(null, current ?? this.platform.Characteristic.Active.INACTIVE);
      return current ?? this.platform.Characteristic.Active.INACTIVE;
    }
    
    return Promise.resolve(current ?? this.platform.Characteristic.Active.INACTIVE);
  }

  private async handleActiveSet(value: CharacteristicValue, callback?: (err?: Error | null) => void): Promise<void> {
    try {
      if (value === this.platform.Characteristic.Active.ACTIVE) {
        await this.deviceAPI.turnOn();
      } else {
        await this.deviceAPI.turnOff();
      }
      this.cacheManager.clear();
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
    // Read current characteristic value
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
      await this.deviceAPI.setFanSpeed(String(value as number));
      this.cacheManager.clear();
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
   * Unsubscribe from centralized status updates
   */
  public stopPolling(): void {
    if (typeof this.cacheManager.api.off === 'function') {
      this.cacheManager.api.off('status', this.statusListener);
    }
  }
}
