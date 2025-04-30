import {
  PlatformAccessory,
  Service,
  CharacteristicValue,
} from 'homebridge';
import { TfiacPlatform } from './platform.js';
import AirConditionerAPI, { AirConditionerStatus } from './AirConditionerAPI.js';
import { TfiacDeviceConfig } from './settings.js';
import { PowerState, FanSpeed } from './enums.js';

export class StandaloneFanAccessory {
  private service: Service;
  private deviceAPI: AirConditionerAPI;
  private cachedStatus: AirConditionerStatus | null = null;
  private pollInterval: number;
  private pollingInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly platform: TfiacPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const serviceName = 'Standalone Fan';
    const deviceConfig = this.accessory.context.deviceConfig as TfiacDeviceConfig;
    this.deviceAPI = new AirConditionerAPI(deviceConfig.ip, deviceConfig.port ?? 7777);
    this.pollInterval = deviceConfig.updateInterval ? deviceConfig.updateInterval * 1000 : 30000;

    this.service =
      this.accessory.getService(serviceName) ||
      this.accessory.addService(this.platform.Service.Fan, serviceName, 'standalone_fan');
    
    this.service.updateCharacteristic(this.platform.Characteristic.ConfiguredName, serviceName);
    
    this.service
      .getCharacteristic(this.platform.Characteristic.On)
      .on('get', this.handleGet.bind(this))
      .on('set', this.handleSet.bind(this));
    this.service
      .getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .on('get', this.handleRotationSpeedGet.bind(this))
      .on('set', this.handleRotationSpeedSet.bind(this));

    this.startPolling();
  }

  public stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.deviceAPI.cleanup();
  }

  private startPolling(): void {
    this.updateCachedStatus();
    
    // Immediately warm up the cache
    this.updateCachedStatus().catch(err => {
      this.platform.log.error('Initial fan state fetch failed:', err);
    });
    
    this.pollingInterval = setInterval(() => {
      this.updateCachedStatus();
    }, this.pollInterval);
    this.pollingInterval.unref();
  }

  private async updateCachedStatus(): Promise<void> {
    try {
      const status = await this.deviceAPI.updateState();
      const oldIsOn = this.cachedStatus?.is_on === PowerState.On;
      this.cachedStatus = status;
      if (this.service && status) {
        const newIsOn = this.cachedStatus.is_on === PowerState.On;
        if (newIsOn !== oldIsOn) {
          this.platform.log.info(`Updating On characteristic for ${this.accessory.displayName} to ${newIsOn}`);
          this.service.updateCharacteristic(this.platform.Characteristic.On, newIsOn);
        }

        const newRotationSpeed = this.mapFanModeToRotationSpeed(this.cachedStatus.fan_mode as FanSpeed);
        this.service.updateCharacteristic(
          this.platform.Characteristic.RotationSpeed,
          newRotationSpeed,
        );
      }
    } catch (error) {
      this.platform.log.error('Error updating fan status:', error);
    }
  }

  private handleGet(callback: (err: Error | null, value?: boolean) => void): void {
    const currentValue = this.cachedStatus ? this.cachedStatus.is_on === PowerState.On : false;
    callback(null, currentValue);
  }

  private handleSet(value: CharacteristicValue, callback: (err?: Error | null) => void): void {
    (async () => {
      try {
        if (value) {
          await this.deviceAPI.turnOn();
        } else {
          await this.deviceAPI.turnOff();
        }
        this.updateCachedStatus();
        callback(null);
      } catch (err) {
        callback(err as Error);
      }
    })();
  }

  private handleRotationSpeedGet(callback: (err: Error | null, value?: number) => void): void {
    const currentValue = this.cachedStatus ? this.mapFanModeToRotationSpeed(this.cachedStatus.fan_mode as FanSpeed) : 50;
    callback(null, currentValue);
  }

  private async handleRotationSpeedSet(value: CharacteristicValue, callback: (err?: Error | null) => void): Promise<void> {
    (async () => {
      try {
        const fanMode = this.mapRotationSpeedToFanMode(value as number);
        await this.deviceAPI.setFanSpeed(fanMode);
        this.updateCachedStatus();
        callback(null);
      } catch (err) {
        callback(err as Error);
      }
    })();
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
