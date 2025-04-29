import {
  Service,
  PlatformAccessory,
  CharacteristicValue,
  CharacteristicSetCallback,
  CharacteristicGetCallback,
} from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { AirConditionerStatus } from './AirConditionerAPI.js';
import { TfiacDeviceConfig } from './settings.js';
import CacheManager from './CacheManager.js';

/**
 * Function type to determine the boolean state from the status object.
 */
type GetStatusValueFn = (status: Partial<AirConditionerStatus>) => boolean;

/**
 * Function type to set the state via the API.
 */
type SetApiStateFn = (value: boolean) => Promise<void>;

/**
 * Base class for simple switch accessories (On/Off).
 * Handles common initialization, polling, and basic get/set handlers.
 */
export abstract class BaseSwitchAccessory {
  protected readonly service: Service;
  protected readonly deviceConfig: TfiacDeviceConfig;
  protected cachedStatus: Partial<AirConditionerStatus> | null = null;
  protected pollingInterval: NodeJS.Timeout | null = null;
  protected initialDelayTimer: NodeJS.Timeout | null = null;
  protected isPolling = false; // Flag to prevent concurrent polling updates
  protected cacheManager: CacheManager;

  constructor(
    protected readonly platform: TfiacPlatform,
    protected readonly accessory: PlatformAccessory,
    private readonly serviceName: string, // e.g., 'Turbo', 'Eco Mode'
    private readonly serviceSubtype: string, // e.g., 'turbo', 'eco'
    private readonly getStatusValue: GetStatusValueFn, // Function to get boolean state from status
    private readonly setApiState: SetApiStateFn,       // Function to set state via API
    protected readonly logPrefix: string, // e.g., 'Turbo', 'Eco' // Changed from private to protected
  ) {
    this.deviceConfig = accessory.context.deviceConfig;
    this.cacheManager = CacheManager.getInstance(this.deviceConfig);

    // Try to get existing service first by subtype, then by name
    this.service =
      this.accessory.getServiceById(this.platform.Service.Switch.UUID, this.serviceSubtype) ||
      this.accessory.getService(this.serviceName) ||
      this.accessory.addService(this.platform.Service.Switch, this.serviceName, this.serviceSubtype);

    this.service.setCharacteristic(this.platform.Characteristic.Name, this.serviceName);

    // Register handlers for the On characteristic
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .on('get', this.handleGet.bind(this))
      .on('set', this.handleSet.bind(this));

    this.startPolling();
    this.platform.log.debug(`${this.logPrefix} accessory initialized for ${this.accessory.displayName}`);
  }

  /**
   * Starts the polling mechanism to update the accessory state periodically.
   */
  startPolling() {
    if (this.pollingInterval || this.initialDelayTimer) {
      this.platform.log.debug(`Polling or initial delay already active for ${this.logPrefix} on ${this.accessory.displayName}.`);
      return;
    }
    const intervalSeconds = this.deviceConfig.updateInterval || 30;
    const intervalMillis = intervalSeconds * 1000;
    // Add random delay up to intervalMillis to stagger API calls
    const randomDelay = Math.random() * intervalMillis;

    this.platform.log.debug(
      `Starting polling for ${this.logPrefix} on ${this.accessory.displayName} with interval ${intervalSeconds}s after ` +
      `${Math.round(randomDelay / 1000)}s delay.`,
    );

    // Initial update after random delay
    this.initialDelayTimer = setTimeout(() => {
      this.initialDelayTimer = null; // Clear the handle once executed
      this.updateCachedStatus();
      // Then set up regular interval
      this.pollingInterval = setInterval(() => {
        this.updateCachedStatus();
      }, intervalMillis);
      // Ensure timer does not keep node process alive
      if (this.pollingInterval.unref) {
        this.pollingInterval.unref();
      }
    }, randomDelay);
    // Ensure initial delay timer does not keep node process alive
    if (this.initialDelayTimer.unref) {
      this.initialDelayTimer.unref();
    }
  }

  /**
   * Stops the polling mechanism and cleans up resources.
   */
  stopPolling() {
    if (this.initialDelayTimer) {
      this.platform.log.debug(`Clearing initial polling delay for ${this.logPrefix} on ${this.accessory.displayName}.`);
      clearTimeout(this.initialDelayTimer);
      this.initialDelayTimer = null;
    }
    if (this.pollingInterval) {
      this.platform.log.debug(`Stopping polling interval for ${this.logPrefix} on ${this.accessory.displayName}.`);
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    } else {
      this.platform.log.debug(`Polling interval already stopped for ${this.logPrefix} on ${this.accessory.displayName}.`);
    }
    // Call cleanup on the cache manager
    this.cacheManager.cleanup();
    this.platform.log.debug(`Called cleanup for ${this.logPrefix} on ${this.accessory.displayName}.`);
  }

  /**
   * Fetches the latest status from the device API and updates the cached status.
   * Updates the characteristic value if it has changed.
   */
  protected async updateCachedStatus(): Promise<void> {
    if (this.isPolling) {
      this.platform.log.debug(`Polling already in progress for ${this.logPrefix} on ${this.accessory.displayName}, skipping.`);
      return;
    }
    this.isPolling = true;
    this.platform.log.debug(`Updating ${this.logPrefix} status for ${this.accessory.displayName}...`);
    // Clear cache to ensure fresh status fetch
    this.cacheManager.clear();
    try {
      const status = await this.cacheManager.getStatus();
      const oldIsOn = this.cachedStatus ? this.getStatusValue(this.cachedStatus) : false;
      this.cachedStatus = status;
      const newIsOn = this.getStatusValue(this.cachedStatus);

      this.platform.log.debug(`Received ${this.logPrefix} status for ${this.accessory.displayName}. Old: ${oldIsOn}, New: ${newIsOn}`);

      if (newIsOn !== oldIsOn) {
        this.platform.log.info(`Updating ${this.logPrefix} characteristic for ${this.accessory.displayName} to ${newIsOn}`);
        this.service.updateCharacteristic(this.platform.Characteristic.On, newIsOn);
      }
    } catch (error) {
      const displayName = this.accessory.displayName;
      this.platform.log.error(`Error updating ${this.logPrefix} status for ${displayName}:`, error);
      // Optionally reset cached status or handle error state
      // this.cachedStatus = null;
      // this.service.updateCharacteristic(this.platform.Characteristic.On, new Error('Polling failed'));
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Handle requests to get the current value of the "On" characteristic.
   */
  protected handleGet(callback: CharacteristicGetCallback) {
    const currentValue = this.cachedStatus ? this.getStatusValue(this.cachedStatus) : false;
    this.platform.log.debug(`Get ${this.logPrefix}: Returning ${currentValue} (Cached: ${JSON.stringify(this.cachedStatus ?? null)})`);
    callback(null, currentValue);
  }

  /**
   * Handle requests to set the "On" characteristic.
   */
  protected async handleSet(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    const requestedState = value as boolean;
    this.platform.log.info(`Set ${this.logPrefix}: Received request to turn ${requestedState ? 'on' : 'off'} for ${this.accessory.displayName}`);

    try {
      await this.setApiState(requestedState);
      this.cacheManager.clear();
      this.platform.log.info(`${this.logPrefix} successfully set to ${requestedState ? 'on' : 'off'} for ${this.accessory.displayName}`);
      this.service.updateCharacteristic(this.platform.Characteristic.On, requestedState);
      callback(null);
    } catch (error) {
      this.platform.log.error(`Error setting ${this.logPrefix} to ${requestedState ? 'on' : 'off'} for ${this.accessory.displayName}:`, error);
      callback(error as Error);
    }
  }
}
