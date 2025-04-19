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

export class SleepSwitchAccessory {
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
      this.accessory.addService(this.platform.Service.Switch, 'Sleep');
    this.service.setCharacteristic(this.platform.Characteristic.Name, 'Sleep');

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
    this.platform.log.debug('Sleep polling stopped for %s', this.accessory.context.deviceConfig.name);
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
      if (typeof status.opt_sleepMode !== 'undefined') {
        const isOn = status.opt_sleepMode !== 'off' && status.opt_sleepMode !== '';
        this.service.updateCharacteristic(this.platform.Characteristic.On, isOn);
      }
    } catch (error) {
      this.platform.log.error('Error updating sleep status:', error);
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
      if (this.cachedStatus && typeof this.cachedStatus.opt_sleepMode !== 'undefined') {
        const isOn = this.cachedStatus.opt_sleepMode !== 'off' && this.cachedStatus.opt_sleepMode !== '';
        safeCallback(null, isOn);
      } else {
        safeCallback(new Error('Sleep status not available'));
      }
    } catch (err) {
      safeCallback(err as Error);
    }
  }

  private async handleSet(value: CharacteristicValue, callback: CharacteristicSetCallback): Promise<void> {
    let called = false;
    const safeCallback = (...args: Parameters<CharacteristicSetCallback>) => {
      if (!called) {
        called = true;
        callback(...args);
      }
    };
    try {
      const sleepValue = value ? 'on' : 'off';
      await this.deviceAPI.setSleepState(sleepValue as 'on' | 'off');
      this.updateCachedStatus();
      safeCallback(null);
    } catch (error) {
      this.platform.log.error('Error setting sleep state:', error);
      safeCallback(error as Error);
    }
  }
}
