import {
  PlatformAccessory,
  Service,
  CharacteristicValue,
} from 'homebridge';
import { TfiacPlatform } from './platform.js';
import AirConditionerAPI, { AirConditionerStatus } from './AirConditionerAPI.js';
import { TfiacDeviceConfig } from './settings.js';

export class HorizontalSwingSwitchAccessory {
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
      this.accessory.getService('Horizontal Swing') ||
      this.accessory.addService(this.platform.Service.Switch, 'Horizontal Swing', 'horizontal_swing');
    this.service.setCharacteristic(this.platform.Characteristic.Name, 'Horizontal Swing');
    this.service
      .getCharacteristic(this.platform.Characteristic.On)
      .on('get', this.handleGet.bind(this))
      .on('set', this.handleSet.bind(this));

    this.startPolling();
  }

  public stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.deviceAPI.cleanup();
    this.platform.log.debug('HorizontalSwing polling stopped for %s', this.accessory.context.deviceConfig.name);
  }

  private startPolling(): void {
    this.updateCachedStatus();
    
    // Immediately warm up the cache
    this.updateCachedStatus().catch(err => {
      this.platform.log.error('Initial horizontal swing state fetch failed:', err);
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
          status.swing_mode === 'Horizontal' || status.swing_mode === 'Both',
        );
      }
    } catch (error) {
      this.platform.log.error('Error updating horizontal swing status:', error);
    }
  }

  private handleGet(callback: (err: Error | null, value?: boolean) => void): void {
    if (this.cachedStatus) {
      callback(null, this.cachedStatus.swing_mode === 'Horizontal' || this.cachedStatus.swing_mode === 'Both');
    } else {
      // Return a default value (off) instead of an error
      callback(null, false);
    }
  }

  private handleSet(value: CharacteristicValue, callback: (err?: Error | null) => void): void {
    (async () => {
      try {
        if (value) {
          // Включить горизонтальный swing (или Both, если уже включён вертикальный)
          const newMode = (this.cachedStatus?.swing_mode === 'Vertical') ? 'Both' : 'Horizontal';
          await this.deviceAPI.setSwingMode(newMode);
        } else {
          // Выключить только горизонтальный swing (если был Both — оставить Vertical)
          const newMode = (this.cachedStatus?.swing_mode === 'Both') ? 'Vertical' : 'Off';
          await this.deviceAPI.setSwingMode(newMode);
        }
        this.updateCachedStatus();
        callback(null);
      } catch (err) {
        callback(err as Error);
      }
    })();
  }
}
