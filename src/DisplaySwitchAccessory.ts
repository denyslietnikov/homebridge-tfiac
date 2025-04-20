import {
  PlatformAccessory,
  Service,
  CharacteristicValue,
} from 'homebridge';
import { TfiacPlatform } from './platform.js';
import AirConditionerAPI, { AirConditionerStatus } from './AirConditionerAPI.js';
import { TfiacDeviceConfig } from './settings.js';

export class DisplaySwitchAccessory {
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

    // Create or retrieve the Switch service
    this.service =
      this.accessory.getService(this.platform.Service.Switch) ||
      this.accessory.addService(this.platform.Service.Switch, 'Display');
    this.service.setCharacteristic(this.platform.Characteristic.Name, 'Display');

    this.startPolling();

    this.service
      .getCharacteristic(this.platform.Characteristic.On)
      .on('get', this.handleGet.bind(this))
      .on('set', this.handleSet.bind(this));
  }

  public stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    if (this.deviceAPI) {
      this.deviceAPI.cleanup();
    }
    this.platform.log.debug('Display polling stopped for %s', this.accessory.context.deviceConfig.name);
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
      if (typeof status.opt_display !== 'undefined') {
        const isOn = status.opt_display === 'on';
        this.service.updateCharacteristic(this.platform.Characteristic.On, isOn);
      }
    } catch (error) {
      this.platform.log.error('Error updating display status:', error);
    }
  }

  private handleGet(callback: (err: Error | null, value?: boolean) => void): void {
    (async () => {
      try {
        if (this.cachedStatus && typeof this.cachedStatus.opt_display !== 'undefined') {
          callback(null, this.cachedStatus.opt_display === 'on');
        } else {
          throw new Error('Display status not available');
        }
      } catch (err) {
        callback(err as Error);
      }
    })();
  }

  private handleSet(value: CharacteristicValue, callback: (err?: Error | null) => void): void {
    (async () => {
      try {
        const displayValue = value ? 'on' : 'off';
        await this.deviceAPI.setDisplayState(displayValue);
        this.updateCachedStatus();
        callback(null);
      } catch (err) {
        callback(err as Error);
      }
    })();
  }
}
