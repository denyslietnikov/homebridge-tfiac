import {
  PlatformAccessory,
  Service,
  CharacteristicValue,
} from 'homebridge';
import { TfiacPlatform } from './platform.js';
import AirConditionerAPI, { AirConditionerStatus } from './AirConditionerAPI.js';
import { TfiacDeviceConfig } from './settings.js';

export class EcoSwitchAccessory {
  private service: Service;
  private deviceAPI: AirConditionerAPI;
  protected cachedStatus: AirConditionerStatus | null = null;
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
      this.accessory.getService('Eco') ||
      this.accessory.addService(this.platform.Service.Switch, 'Eco', 'eco');
    this.service.setCharacteristic(this.platform.Characteristic.Name, 'ECO Mode');
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
    this.platform.log.debug('Eco polling stopped for %s', this.accessory.context.deviceConfig.name);
  }

  private startPolling(): void {
    // Initial status fetch
    this.updateCachedStatus();

    // Generate a random delay between 0 and 15 seconds to distribute network requests
    const warmupDelay = Math.floor(Math.random() * 15000);
    
    // Warm up the cache with a delay to prevent network overload
    setTimeout(() => {
      this.updateCachedStatus().catch(err => {
        this.platform.log.error('Initial eco state fetch failed:', err);
      });
    }, warmupDelay);
    
    this.pollingInterval = setInterval(() => {
      this.updateCachedStatus();
    }, this.pollInterval);
    // Only call unref if available (NodeJS environment); JSDOM returns number
    if (this.pollingInterval && typeof (this.pollingInterval as NodeJS.Timeout).unref === 'function') {
      (this.pollingInterval as NodeJS.Timeout).unref();
    }
  }

  protected async updateCachedStatus(): Promise<void> {
    try {
      const status = await this.deviceAPI.updateState();
      this.cachedStatus = status;
      // Only update characteristics if opt_eco is present and not undefined
      if (
        this.pollingInterval &&
        this.service &&
        status &&
        Object.prototype.hasOwnProperty.call(status, 'opt_eco') &&
        typeof status.opt_eco !== 'undefined'
      ) {
        this.service.updateCharacteristic(
          this.platform.Characteristic.On,
          status.opt_eco === 'on',
        );
      }
    } catch (error) {
      this.platform.log.error('Error updating eco status:', error);
    }
  }

  private handleGet(callback: (err: Error | null, value?: boolean) => void): void {
    if (this.cachedStatus && typeof this.cachedStatus.opt_eco !== 'undefined') {
      callback(null, this.cachedStatus.opt_eco === 'on');
    } else {
      // Return a default value (off) instead of an error
      callback(null, false);
    }
  }

  private async handleSet(value: CharacteristicValue, callback: (err?: Error | null) => void): Promise<void> {
    try {
      await this.deviceAPI.setEcoState(value ? 'on' : 'off');
      await this.updateCachedStatus();
      callback(null);
    } catch (err) {
      callback(err as Error);
    }
  }
}
