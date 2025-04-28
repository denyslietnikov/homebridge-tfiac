import {
  Service,
  PlatformAccessory,
  CharacteristicValue,
  CharacteristicSetCallback,
  CharacteristicGetCallback,
} from 'homebridge';
import { TfiacPlatform } from './platform.js';
import AirConditionerAPI, { AirConditionerStatus } from './AirConditionerAPI.js';
import { TfiacDeviceConfig } from './settings.js';
import CacheManager from './CacheManager.js';

/**
 * Base class for simple switch accessories (On/Off).
 * Handles common initialization, polling, and basic get/set handlers.
 */
export abstract class BaseSwitchAccessory {
  protected readonly service: Service;
  protected readonly deviceAPI: AirConditionerAPI;
  protected readonly deviceConfig: TfiacDeviceConfig;
  protected cachedStatus: Partial<AirConditionerStatus> | null = null;
  protected pollingInterval: NodeJS.Timeout | null = null;
  protected isPolling = false; // Flag to prevent concurrent polling updates
  private cacheManager: CacheManager;

  constructor(
    protected readonly platform: TfiacPlatform,
    protected readonly accessory: PlatformAccessory,
    private readonly serviceName: string, // e.g., 'Turbo', 'Eco Mode'
    private readonly serviceSubtype: string, // e.g., 'turbo', 'eco'
    private readonly statusKey: keyof AirConditionerStatus, // e.g., 'opt_super', 'opt_eco'
    private readonly apiSetMethod: (value: 'on' | 'off') => Promise<void>, // Bound API method, e.g., this.deviceAPI.setTurboState.bind(this.deviceAPI)
    private readonly logPrefix: string, // e.g., 'Turbo', 'Eco'
  ) {
    this.deviceConfig = accessory.context.deviceConfig;
    this.cacheManager = CacheManager.getInstance(this.deviceConfig);
    // Ensure deviceAPI is instantiated here if not passed in
    this.deviceAPI = new AirConditionerAPI(this.deviceConfig.ip, this.deviceConfig.port);

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
    if (this.pollingInterval) {
      this.platform.log.debug(`Polling already started for ${this.logPrefix} on ${this.accessory.displayName}.`);
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
    setTimeout(() => {
      this.updateCachedStatus();
      // Then set up regular interval
      this.pollingInterval = setInterval(() => {
        this.updateCachedStatus();
      }, intervalMillis);
    }, randomDelay);
  }

  /**
   * Stops the polling mechanism.
   */
  stopPolling() {
    if (this.pollingInterval) {
      this.platform.log.debug(`Stopping polling for ${this.logPrefix} on ${this.accessory.displayName}.`);
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    } else {
      this.platform.log.debug(`Polling already stopped for ${this.logPrefix} on ${this.accessory.displayName}.`);
    }
    // Clean up the API connection if necessary
    if (this.deviceAPI && typeof this.deviceAPI.cleanup === 'function') {
      this.deviceAPI.cleanup();
    }
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
      this.platform.log.debug(`Received ${this.logPrefix} status for ${this.accessory.displayName}:`, status[this.statusKey]);
      const oldStatus = this.cachedStatus ? this.cachedStatus[this.statusKey] : undefined;
      this.cachedStatus = status;
      const newStatus = this.cachedStatus[this.statusKey];

      if (newStatus !== undefined && newStatus !== oldStatus) {
        const isOn = newStatus === 'on';
        this.platform.log.info(`Updating ${this.logPrefix} characteristic for ${this.accessory.displayName} to ${isOn}`);
        this.service.updateCharacteristic(this.platform.Characteristic.On, isOn);
      } else if (newStatus === undefined) {
        // Only log warning if the key is expected but missing
        if (this.statusKey in status) {
          this.platform.log.warn(`Status key '${this.statusKey}' has undefined value in API response for ${this.logPrefix} on ${this.accessory.displayName}.`);
        } else {
          this.platform.log.debug(`Status key '${this.statusKey}' not present in API response for ${this.logPrefix} on ${this.accessory.displayName}.`);
        }
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
    const currentValue = this.cachedStatus ? this.cachedStatus[this.statusKey] === 'on' : false;
    this.platform.log.debug(`Get ${this.logPrefix}: Returning ${currentValue} (Cached: ${this.cachedStatus ? this.cachedStatus[this.statusKey] : 'null'})`);
    callback(null, currentValue);
  }

  /**
   * Handle requests to set the "On" characteristic.
   */
  protected async handleSet(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    const requestedState = value as boolean ? 'on' : 'off';
    this.platform.log.info(`Set ${this.logPrefix}: Received request to turn ${requestedState} for ${this.accessory.displayName}`);

    // Avoid redundant calls if state is already correct (optional)
    // if (this.cachedStatus && this.cachedStatus[this.statusKey] === requestedState) {
    //   this.platform.log.debug(`${this.logPrefix} is already ${requestedState}. Skipping API call.`);
    //   callback(null);
    //   return;
    // }

    try {
      await this.apiSetMethod(requestedState);
      this.cacheManager.clear();
      this.platform.log.info(`${this.logPrefix} successfully set to ${requestedState} for ${this.accessory.displayName}`);
      // Optimistically update cache and characteristic
      if (this.cachedStatus) {
        // Assert that the property corresponding to statusKey accepts 'on' | 'off'
        (this.cachedStatus as { [k in typeof this.statusKey]?: 'on' | 'off' })[this.statusKey] = requestedState;
      }
      this.service.updateCharacteristic(this.platform.Characteristic.On, value as boolean);
      callback(null);

      // Optionally trigger a status update soon after setting
      // setTimeout(() => this.updateCachedStatus(), 1000);

    } catch (error) {
      this.platform.log.error(`Error setting ${this.logPrefix} to ${requestedState} for ${this.accessory.displayName}:`, error);
      callback(error as Error);
      // Revert optimistic update on error
      // this.service.updateCharacteristic(this.platform.Characteristic.On, !value);
    }
  }
}
