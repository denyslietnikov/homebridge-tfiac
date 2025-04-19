import {
  PlatformAccessory,
  Service,
  CharacteristicValue,
  CharacteristicSetCallback,
  CharacteristicGetCallback,
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
      this.accessory.getService(this.platform.Service.Fan) ||
      this.accessory.addService(this.platform.Service.Fan, 'Fan Speed');
    this.service.setCharacteristic(
      this.platform.Characteristic.Name,
      'Fan Speed',
    );

    this.startPolling();

    this.service
      .getCharacteristic(
        this.platform.Characteristic.RotationSpeed,
      )
      .on('get', this.handleGet.bind(this))
      .on('set', this.handleSet.bind(this));
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
    this.updateCachedStatus();
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

  private handleGet(callback: CharacteristicGetCallback): void {
    let called = false;
    const safeCallback = (...args: Parameters<CharacteristicGetCallback>) => {
      if (!called) {
        called = true;
        callback(...args);
      }
    };
    try {
      if (this.cachedStatus && typeof this.cachedStatus.fan_mode !== 'undefined') {
        const speed = parseInt(this.cachedStatus.fan_mode as string, 10) || 0;
        safeCallback(null, speed);
      } else {
        safeCallback(new Error('Fan speed status not available'));
      }
    } catch (err) {
      safeCallback(err as Error);
    }
  }

  private async handleSet(
    value: CharacteristicValue,
    callback: CharacteristicSetCallback,
  ): Promise<void> {
    let called = false;
    const safeCallback = (...args: Parameters<CharacteristicSetCallback>) => {
      if (!called) {
        called = true;
        callback(...args);
      }
    };
    try {
      const speedStr = String(value as number);
      await this.deviceAPI.setFanSpeed(speedStr);
      this.updateCachedStatus();
      safeCallback(null);
    } catch (error) {
      this.platform.log.error('Error setting fan speed:', error);
      safeCallback(error as Error);
    }
  }
}
