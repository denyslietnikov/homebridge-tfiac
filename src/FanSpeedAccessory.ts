import {
  PlatformAccessory,
  Service,
  CharacteristicValue,
} from 'homebridge';
import { TfiacPlatform } from './platform.js';
import AirConditionerAPI, { AirConditionerStatus } from './AirConditionerAPI.js';
import { TfiacDeviceConfig } from './settings.js';

export class FanSpeedAccessory {
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
    this.pollInterval =
      deviceConfig.updateInterval ? deviceConfig.updateInterval * 1000 : 30000;

    // Create or retrieve the Fan service
    this.service =
      this.accessory.getService('Fan Speed') ||
      this.accessory.addService(this.platform.Service.Fanv2, 'Fan Speed', 'fan_speed');
    this.service.setCharacteristic(
      this.platform.Characteristic.Name,
      'Fan Speed',
    );

    this.startPolling();

    this.service
      .getCharacteristic(
        this.platform.Characteristic.RotationSpeed,
      )
      .on('get', (callback) => this.handleGet(callback))
      .on('set', (value, callback) => this.handleSet(value, callback));
  }

  public stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.deviceAPI.cleanup();
    this.platform.log.debug(
      'FanSpeed polling stopped for %s',
      this.accessory.context.deviceConfig.name,
    );
  }

  private startPolling(): void {
    // Remove duplicate call to updateCachedStatus
    
    // Immediately warm up the cache
    this.updateCachedStatus().catch(err => {
      this.platform.log.error('Initial fan speed state fetch failed:', err);
    });
    
    this.pollingInterval = setInterval(() => {
      this.updateCachedStatus();
    }, this.pollInterval);
    // Ensure timer does not keep node process alive
    this.pollingInterval.unref();
  }

  private async updateCachedStatus(): Promise<void> {
    try {
      const status = await this.deviceAPI.updateState();
      this.cachedStatus = status;
      if (typeof status.fan_mode !== 'undefined') {
        const speed = parseInt(status.fan_mode as string, 10) || 0;
        this.service.updateCharacteristic(
          this.platform.Characteristic.RotationSpeed,
          speed,
        );
      }
    } catch (error) {
      this.platform.log.error('Error updating fan speed status:', error);
    }
  }

  private handleGet(callback: (err: Error | null, value?: number) => void): void {
    (async () => {
      try {
        if (this.cachedStatus && typeof this.cachedStatus.fan_mode !== 'undefined') {
          callback(null, parseInt(this.cachedStatus.fan_mode as string, 10) || 0);
        } else {
          // Return a default value (medium speed - 50) instead of an error
          callback(null, 50);
        }
      } catch (err) {
        // Return a default value instead of an error
        callback(null, 50);
      }
    })();
  }

  private handleSet(value: CharacteristicValue, callback: (err?: Error | null) => void): void {
    (async () => {
      try {
        const speedStr = String(value as number);
        await this.deviceAPI.setFanSpeed(speedStr);
        this.updateCachedStatus();
        callback(null);
      } catch (err) {
        callback(err as Error);
      }
    })();
  }
}
