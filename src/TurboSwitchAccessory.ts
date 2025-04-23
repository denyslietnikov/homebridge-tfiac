import {
  PlatformAccessory,
  Service,
  CharacteristicValue,
} from 'homebridge';
import { TfiacPlatform } from './platform.js';
import AirConditionerAPI, { AirConditionerStatus } from './AirConditionerAPI.js';
import { TfiacDeviceConfig } from './settings.js';

export class TurboSwitchAccessory {
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
      this.accessory.getService('Turbo') ||
      this.accessory.addService(this.platform.Service.Switch, 'Turbo', 'turbo');
    this.service.setCharacteristic(this.platform.Characteristic.Name, 'Turbo');
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
    this.platform.log.debug('Turbo polling stopped for %s', this.accessory.context.deviceConfig.name);
  }

  private startPolling(): void {
    this.updateCachedStatus();
    
    // Generate a random delay between 0 and 15 seconds to distribute network requests
    const warmupDelay = Math.floor(Math.random() * 15000);
    
    // Warm up the cache with a delay to prevent network overload
    setTimeout(() => {
      this.updateCachedStatus().catch(err => {
        this.platform.log.error('Initial turbo state fetch failed:', err);
      });
    }, warmupDelay);
    
    this.pollingInterval = setInterval(() => {
      this.updateCachedStatus();
    }, this.pollInterval);
    // Only call unref if available (NodeJS environment); in JSDOM setInterval returns number
    if (this.pollingInterval && typeof this.pollingInterval.unref === 'function') {
      (this.pollingInterval as NodeJS.Timeout).unref();
    }
  }

  protected async updateCachedStatus(): Promise<void> {
    try {
      const status = await this.deviceAPI.updateState();
      this.cachedStatus = status;
      // Only update characteristics if opt_super is present and not undefined
      if (
        this.pollingInterval &&
        this.service &&
        status &&
        Object.prototype.hasOwnProperty.call(status, 'opt_super') &&
        typeof status.opt_super !== 'undefined'
      ) {
        this.service.updateCharacteristic(
          this.platform.Characteristic.On,
          status.opt_super === 'on',
        );
      }
    } catch (error) {
      this.platform.log.error('Error updating turbo status:', error);
    }
  }

  private handleGet(callback: (err: Error | null, value?: boolean) => void): void {
    if (this.cachedStatus && typeof this.cachedStatus.opt_super !== 'undefined') {
      callback(null, this.cachedStatus.opt_super === 'on');
    } else {
      // Return a default value (off) instead of an error
      callback(null, false);
    }
  }

  private async handleSet(value: CharacteristicValue, callback: (err?: Error | null) => void): Promise<void> {
    try {
      const turboValue = value ? 'on' : 'off';
      // Support both setTurboState (real API) and setSuperState (unit tests)
      if (typeof this.deviceAPI.setTurboState === 'function') {
        await this.deviceAPI.setTurboState(turboValue as 'on' | 'off');
      } else if (
        'setSuperState' in this.deviceAPI && 
        typeof (this.deviceAPI as AirConditionerAPI & { 
          setSuperState?: (value: string) => Promise<void> 
        }).setSuperState === 'function'
      ) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (this.deviceAPI as any).setSuperState(turboValue); // Keep any here if setSuperState is truly dynamic/test-only
      } else {
        throw new Error('No method available to set turbo state');
      }
      await this.updateCachedStatus();
      callback(null);
    } catch (err) {
      callback(err as Error);
    }
  }
}
