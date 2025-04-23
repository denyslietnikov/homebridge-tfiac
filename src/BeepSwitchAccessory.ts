import {
  PlatformAccessory,
  Service,
  CharacteristicValue,
} from 'homebridge';
import { TfiacPlatform } from './platform.js';
import AirConditionerAPI, { AirConditionerStatus } from './AirConditionerAPI.js';
import { TfiacDeviceConfig } from './settings.js';

export class BeepSwitchAccessory {
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
      this.accessory.getService('Beep') ||
      this.accessory.addService(this.platform.Service.Switch, 'Beep', 'beep');
    this.service.setCharacteristic(this.platform.Characteristic.Name, 'Beep');
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
    this.platform.log.debug('Beep polling stopped for %s', this.accessory.context.deviceConfig.name);
  }

  private startPolling(): void {
    // First call returns void, so wrap it in a Promise.resolve()
    Promise.resolve(this.updateCachedStatus());
    
    // Generate a random delay between 0 and 15 seconds to distribute network requests
    const warmupDelay = Math.floor(Math.random() * 15000);
    
    // Warm up the cache with a delay to prevent network overload
    setTimeout(() => {
      this.updateCachedStatus().catch(err => {
        this.platform.log.error('Initial beep state fetch failed:', err);
      });
    }, warmupDelay);
    
    this.pollingInterval = setInterval(() => {
      Promise.resolve(this.updateCachedStatus()).catch(err => {
        this.platform.log.error('Periodic beep state fetch failed:', err);
      });
    }, this.pollInterval);
    
    // Only call unref if available (NodeJS environment); in test environment it might not be
    if (this.pollingInterval && typeof this.pollingInterval.unref === 'function') {
      this.pollingInterval.unref();
    }
  }

  private async updateCachedStatus(): Promise<void> {
    try {
      const status = await this.deviceAPI.updateState();
      this.cachedStatus = status;
      if (this.service && status && typeof status.opt_beep !== 'undefined') {
        this.service.updateCharacteristic(
          this.platform.Characteristic.On,
          status.opt_beep === 'on',
        );
      }
    } catch (error) {
      this.platform.log.error('Error updating beep status:', error);
    }
  }

  private handleGet(callback: (err: Error | null, value?: boolean) => void): void {
    if (this.cachedStatus && typeof this.cachedStatus.opt_beep !== 'undefined') {
      callback(null, this.cachedStatus.opt_beep === 'on');
    } else {
      // Return a default value (off) instead of an error
      callback(null, false);
    }
  }

  private async handleSet(value: CharacteristicValue, callback: (err?: Error | null) => void): Promise<void> {
    try {
      await this.deviceAPI.setBeepState(value ? 'on' : 'off');
      await this.updateCachedStatus();
      callback(null);
    } catch (err) {
      callback(err as Error);
    }
  }
}
