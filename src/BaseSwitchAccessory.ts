import {
  Service,
  PlatformAccessory,
  CharacteristicValue,
  CharacteristicSetCallback,
} from 'homebridge';
import type { WithUUID, Characteristic } from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { AirConditionerStatus } from './AirConditionerAPI.js';
import { TfiacDeviceConfig } from './settings.js';
import * as CacheMgrModule from './CacheManager.js';
import type { CacheManager } from './CacheManager.js';
// Prefer named export, then default, then throw an error if no valid export is found
const CacheManagerClass =
  (CacheMgrModule as { CacheManager?: { getInstance: (config: TfiacDeviceConfig) => CacheManager } }).CacheManager ??
  (CacheMgrModule as { default?: { getInstance: (config: TfiacDeviceConfig) => CacheManager } }).default ??
  (() => {
    throw new Error('No CacheManager export found'); 
  })();

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
  protected readonly service: Service | undefined;
  private readonly nameChar: WithUUID<new () => Characteristic>;
  protected readonly onChar: WithUUID<new () => Characteristic>;
  protected readonly deviceConfig: TfiacDeviceConfig;
  protected cachedStatus: Partial<AirConditionerStatus> | null = null;

  protected isPolling = false; // Flag to prevent concurrent polling updates
  protected cacheManager: CacheManager;

  // Listener for centralized status updates
  private statusListener!: (status: import('./AirConditionerAPI').AirConditionerStatus | null) => void;

  constructor(
    protected readonly platform: TfiacPlatform,
    protected readonly accessory: PlatformAccessory,
    private readonly serviceName: string, // e.g., 'Turbo', 'Eco Mode'
    private readonly serviceSubtype: string, // e.g., 'turbo', 'eco'
    private readonly getStatusValue: GetStatusValueFn, // Function to get boolean state from status
    private readonly setApiState: SetApiStateFn,       // Function to set state via API
    protected readonly logPrefix: string, // e.g., 'Turbo', 'Eco'
  ) {
    this.deviceConfig = accessory.context.deviceConfig;
    this.cacheManager = CacheManagerClass.getInstance(this.deviceConfig);
    // Subscribe to API debug events when plugin debug mode is enabled
    if (this.platform.config?.debug && this.cacheManager?.api && typeof this.cacheManager.api.on === 'function') {
      this.cacheManager.api.on('debug', (msg: string) => {
        // Always log API debug messages at info level when plugin debug is enabled
        this.platform.log.info(`${this.logPrefix} API: ${msg}`);
      });
    }

    // 1) Try by UUID + subtype, 2) fall back to service name
    this.service =
      this.accessory.getServiceById(this.platform.Service.Switch.UUID, this.serviceSubtype) ||
      this.accessory.getService(this.serviceName);

    // If service doesn't exist, check if there's a conflict before adding a new one
    if (!this.service) {
      try {
        this.service = this.accessory.addService(this.platform.Service.Switch, this.serviceName, this.serviceSubtype);
      } catch (error) {
        // If we encounter an error adding the service, try to recover
        this.platform.log.warn(
          `Error adding ${this.serviceName} service (subtype '${this.serviceSubtype}') to ${this.accessory.displayName}: ${error}`,
        );
        // Last resort: Generate a unique subtype and try again
        const uniqueSubtype = `${this.serviceSubtype}_${Date.now()}`;
        this.platform.log.debug(`Trying to add service with unique subtype: ${uniqueSubtype}`);
        this.service = this.accessory.addService(this.platform.Service.Switch, this.serviceName, uniqueSubtype);
      }
    }

    // Determine characteristic constructions for Name and On
    this.nameChar = this.platform.Characteristic.Name;
    this.onChar = this.platform.Characteristic.On;

    // Set the service name characteristic
    if (this.service) {
      this.service.setCharacteristic(this.nameChar, this.serviceName);
      // ALSO set the configured name characteristic for better display in Home app
      if (typeof this.platform.Characteristic.ConfiguredName !== 'undefined') {
        this.service.setCharacteristic(this.platform.Characteristic.ConfiguredName, this.serviceName);
      }

      // Register handlers for the On characteristic
      const onCharacteristic = this.service.getCharacteristic(this.onChar)!; // assert non-null
      // Register handlers via onGet/onSet if available, fallback to .on('get')/.on('set')
      if (onCharacteristic && typeof onCharacteristic.onGet === 'function' && typeof onCharacteristic.onSet === 'function') {
        onCharacteristic.onGet(this.handleGet.bind(this));
        onCharacteristic.onSet(this.handleSet.bind(this));
      } else if (onCharacteristic && typeof onCharacteristic.on === 'function') {
        onCharacteristic.on('get', this.handleGet.bind(this));
        onCharacteristic.on('set', this.handleSet.bind(this));
      }

      this.platform.log.debug(`${this.logPrefix} accessory initialized for ${this.accessory.displayName}`);
      // Subscribe to centralized status updates instead of individual polling
      this.statusListener = this.updateStatus.bind(this);
      if (this.cacheManager?.api && typeof this.cacheManager.api.on === 'function') {
        this.cacheManager.api.on('status', this.statusListener);
      }
    } else {
      this.platform.log.error(`Failed to initialize ${this.logPrefix} accessory for ${this.accessory.displayName}: no service available`);
    }
  }

  /** Unsubscribe from centralized status updates */
  public stopPolling(): void {
    // Safely clean up if available
    this.cacheManager?.cleanup?.();
    // Unsubscribe listeners if supported
    this.cacheManager?.api?.off?.('status', this.statusListener!);
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
      const oldValue = this.cachedStatus ? this.getStatusValue(this.cachedStatus) : false;
      this.cachedStatus = status;
      const newValue = this.getStatusValue(status as Partial<import('./AirConditionerAPI').AirConditionerStatus>);
      if (newValue !== oldValue && this.service) {
        this.platform.log.info(`Updating ${this.logPrefix} characteristic for ${this.accessory.displayName} to ${newValue}`);
        this.service.updateCharacteristic(this.onChar, newValue);
      }
    } catch (error) {
      this.platform.log.error(`Error updating ${this.logPrefix} status for ${this.accessory.displayName}:`, error);
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Update this switch based on centralized status.
   */
  public updateStatus(status: import('./AirConditionerAPI').AirConditionerStatus | null): void {
    // Update cached status and characteristic
    this.cachedStatus = status;
    const newValue = status ? this.getStatusValue(status) : false;
    if (this.service) {
      this.service.updateCharacteristic(this.onChar, newValue);
    }
  }

  /**
   * Handle requests to get the current value of the "On" characteristic.
   */
  protected handleGet(callback?: (error: Error | null, value?: boolean) => void): boolean {
    // Support both promise-based (homebridge/HAP v1.4.0+) and callback-based API
    const value = this.cachedStatus ? this.getStatusValue(this.cachedStatus) : false;
    
    if (callback && typeof callback === 'function') {
      // Callback-style API (for backward compatibility)
      // Call the callback but still return the value to satisfy the type checker
      callback(null, value);
    }
    
    // Return the value directly - works for promise pattern and satisfies the type for callback pattern
    return value;
  }

  /**
   * Handle requests to set the "On" characteristic.
   */
  protected async handleSet(value: CharacteristicValue, callback?: CharacteristicSetCallback): Promise<void> {
    const requestedState = value as boolean;
    this.platform.log.info(`Set ${this.logPrefix}: Received request to turn ${requestedState ? 'on' : 'off'} for ${this.accessory.displayName}`);

    try {
      await this.setApiState(requestedState);
      this.cacheManager.clear();
      this.platform.log.info(`${this.logPrefix} successfully set to ${requestedState ? 'on' : 'off'} for ${this.accessory.displayName}`);
      if (this.service) {
        this.service.updateCharacteristic(this.onChar, requestedState);
      }
      if (callback && typeof callback === 'function') {
        callback(null);
      }
    } catch (error) {
      this.platform.log.error(`Error setting ${this.logPrefix} to ${requestedState ? 'on' : 'off'} for ${this.accessory.displayName}:`, error);
      if (callback && typeof callback === 'function') {
        callback(error as Error);
      } else {
        throw error; // Re-throw for promise-based API
      }
    }
  }
}
