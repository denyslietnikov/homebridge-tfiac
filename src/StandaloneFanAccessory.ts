import {
  PlatformAccessory,
  Service,
  CharacteristicValue,
} from 'homebridge';
import { TfiacPlatform } from './platform.js';
import AirConditionerAPI, { AirConditionerStatus } from './AirConditionerAPI.js';
import { TfiacDeviceConfig } from './settings.js';

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
    const deviceConfig = this.accessory.context.deviceConfig as TfiacDeviceConfig;
    const ip = deviceConfig.ip;
    const port = deviceConfig.port ?? 7777;
    this.deviceAPI = new AirConditionerAPI(ip, port);
    this.pollInterval = deviceConfig.updateInterval ? deviceConfig.updateInterval * 1000 : 30000;

    this.service =
      this.accessory.getService('Standalone Fan') ||
      this.accessory.addService(this.platform.Service.Fan, 'Standalone Fan', 'standalone_fan');
    this.service.setCharacteristic(this.platform.Characteristic.Name, 'Fan');
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
      this.cachedStatus = status;
      if (this.service && status) {
        this.service.updateCharacteristic(
          this.platform.Characteristic.On,
          status.is_on === 'on',
        );
        this.service.updateCharacteristic(
          this.platform.Characteristic.RotationSpeed,
          this.mapFanModeToRotationSpeed(status.fan_mode),
        );
      }
    } catch (error) {
      this.platform.log.error('Error updating fan status:', error);
    }
  }

  private handleGet(callback: (err: Error | null, value?: boolean) => void): void {
    if (this.cachedStatus) {
      callback(null, this.cachedStatus.is_on === 'on');
    } else {
      // Return a default value (off) instead of an error
      callback(null, false);
    }
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
    if (this.cachedStatus) {
      callback(null, this.mapFanModeToRotationSpeed(this.cachedStatus.fan_mode));
    } else {
      // Return a default medium speed (50) instead of an error
      callback(null, 50);
    }
  }

  private handleRotationSpeedSet(value: CharacteristicValue, callback: (err?: Error | null) => void): void {
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

  private mapFanModeToRotationSpeed(fanMode: string): number {
    const fanSpeedMap: { [key: string]: number } = {
      Auto: 50,
      Low: 25,
      Middle: 50,
      High: 75,
    };
    return fanSpeedMap[fanMode] || 50;
  }

  private mapRotationSpeedToFanMode(speed: number): string {
    if (speed <= 25) {
      return 'Low';
    } else if (speed <= 50) {
      return 'Middle';
    } else if (speed <= 75) {
      return 'High';
    } else {
      return 'Auto';
    }
  }
}
