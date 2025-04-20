import {
  PlatformAccessory,
  Service,
  CharacteristicValue,
} from 'homebridge';
import { TfiacPlatform } from './platform.js';
import AirConditionerAPI, { AirConditionerStatus } from './AirConditionerAPI.js';
import { TfiacDeviceConfig } from './settings.js';

export class DrySwitchAccessory {
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
      this.accessory.getService('Dry Mode') ||
      this.accessory.addService(this.platform.Service.Switch, 'Dry Mode', 'dry_mode');
    this.service.setCharacteristic(this.platform.Characteristic.Name, 'Dry Mode');
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
    this.platform.log.debug('DrySwitch polling stopped for %s', this.accessory.context.deviceConfig.name);
  }

  private startPolling(): void {
    this.updateCachedStatus();
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
          status.operation_mode === 'dry',
        );
      }
    } catch (error) {
      this.platform.log.error('Error updating dry mode status:', error);
    }
  }

  private handleGet(callback: (err: Error | null, value?: boolean) => void): void {
    if (this.cachedStatus) {
      callback(null, this.cachedStatus.operation_mode === 'dry');
    } else {
      callback(new Error('Dry mode status not available'));
    }
  }

  private handleSet(value: CharacteristicValue, callback: (err?: Error | null) => void): void {
    (async () => {
      try {
        if (value) {
          await this.deviceAPI.setAirConditionerState('operation_mode', 'dry');
        } else {
          // Default to 'auto' when turning off dry mode
          await this.deviceAPI.setAirConditionerState('operation_mode', 'auto');
        }
        this.updateCachedStatus();
        callback(null);
      } catch (err) {
        callback(err as Error);
      }
    })();
  }
}
