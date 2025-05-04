import {
  PlatformAccessory,
  Service,
  CharacteristicValue,
} from 'homebridge';
import { TfiacPlatform } from './platform.js';
import AirConditionerAPI, { AirConditionerStatus } from './AirConditionerAPI.js';
import { TfiacDeviceConfig } from './settings.js';
import { PowerState, FanSpeed } from './enums.js';
import CacheManager from './CacheManager.js';

export class StandaloneFanAccessory {
  private service: Service;
  private deviceAPI: AirConditionerAPI;
  private cacheManager: CacheManager;

  constructor(
    private readonly platform: TfiacPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const serviceName = 'Standalone Fan';
    const deviceConfig = this.accessory.context.deviceConfig as TfiacDeviceConfig;
    this.cacheManager = CacheManager.getInstance(deviceConfig);
    this.deviceAPI = this.cacheManager.api;

    const existingService =
      this.accessory.getService(serviceName) ||
      this.accessory.getServiceById(this.platform.Service.Fan, 'standalone_fan') ||
      this.accessory.getServiceById(this.platform.Service.Fan.UUID, 'standalone_fan');

    this.service =
      existingService ||
      this.accessory.addService(this.platform.Service.Fan, serviceName, 'standalone_fan');
    this.service.updateCharacteristic(this.platform.Characteristic.ConfiguredName, serviceName);

    // Subscribe to centralized status updates
    this.cacheManager.api.on('status', this.updateStatus.bind(this));
    this.service
      .getCharacteristic(this.platform.Characteristic.On)
      .on('get', this.handleGet.bind(this))
      .on('set', this.handleSet.bind(this));
    this.service
      .getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .on('get', this.handleRotationSpeedGet.bind(this))
      .on('set', this.handleRotationSpeedSet.bind(this));
  }

  /** No-op stub for stopPolling; cleanup handled by platform */
  public stopPolling(): void {
    // nothing to clear
  }

  private updateStatus(status: Partial<AirConditionerStatus> | null): void {
    const isOn = status && status.is_on ? status.is_on === PowerState.On : false;
    this.service.updateCharacteristic(this.platform.Characteristic.On, isOn);
    const speed = status && typeof status.fan_mode === 'string'
      ? this.mapFanModeToRotationSpeed(status.fan_mode as FanSpeed)
      : 50;
    this.service.updateCharacteristic(this.platform.Characteristic.RotationSpeed, speed);
  }

  private handleGet(callback?: (err: Error | null, value?: boolean) => void): boolean | Promise<boolean> {
    const value = this.service.getCharacteristic(this.platform.Characteristic.On).value as boolean;
    
    if (callback && typeof callback === 'function') {
      callback(null, value ?? false);
      return value ?? false;
    }
    
    return Promise.resolve(value ?? false);
  }

  private async handleSet(value: CharacteristicValue, callback?: (err?: Error | null) => void): Promise<void> {
    try {
      if (value) {
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

  private handleRotationSpeedGet(callback?: (err: Error | null, value?: number) => void): number | Promise<number> {
    const value = this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed).value as number;
    
    if (callback && typeof callback === 'function') {
      callback(null, value ?? 50);
      return value ?? 50;
    }
    
    return Promise.resolve(value ?? 50);
  }

  private async handleRotationSpeedSet(value: CharacteristicValue, callback?: (err?: Error | null) => void): Promise<void> {
    try {
      await this.deviceAPI.setFanSpeed(this.mapRotationSpeedToFanMode(value as number));
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

  private mapFanModeToRotationSpeed(fanMode: FanSpeed): number {
    const fanSpeedMap: { [key in FanSpeed]?: number } = {
      [FanSpeed.Auto]: 50,
      [FanSpeed.Low]: 25,
      [FanSpeed.Middle]: 50,
      [FanSpeed.High]: 75,
    };
    return fanSpeedMap[fanMode] ?? 50; // Default to 50 if mode is unknown
  }

  private mapRotationSpeedToFanMode(speed: number): FanSpeed {
    if (speed <= 25) {
      return FanSpeed.Low;
    } else if (speed <= 50) {
      return FanSpeed.Middle;
    } else if (speed <= 75) {
      return FanSpeed.High;
    } else {
      return FanSpeed.Auto;
    }
  }
}
