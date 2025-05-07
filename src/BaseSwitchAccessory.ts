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
  public cachedStatus: Partial<AirConditionerStatus> | null = null;

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
        // Subscribe to both new and legacy status events
        this.cacheManager.api.on('status', this.statusListener);
        this.cacheManager.api.on('statusChanged', this.statusListener);
      }
      // Subscribe to API debug events when debug mode is enabled
      if (this.platform.config?.debug && this.cacheManager?.api && typeof this.cacheManager.api.on === 'function') {
        this.cacheManager.api.on('debug', (msg: string) => {
          this.platform.log.debug(`API debug: ${msg}`);
        });
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
    // Unsubscribe from both events
    this.cacheManager?.api?.off?.('status', this.statusListener!);
    this.cacheManager?.api?.off?.('statusChanged', this.statusListener!);
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
    
    try {
      // Always fetch latest status
      const status = await this.cacheManager.getStatus();
      
      // Update cached status and the characteristic if needed
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

  /** Update this switch based on centralized status. */
  public updateStatus(status: Partial<AirConditionerStatus> | null): void {
    // If status is null, clear cached status without updating characteristic
    if (status === null) {
      this.cachedStatus = null;
      return;
    }
    // Determine if this is the first status update
    const isFirst = this.cachedStatus === null;
    // Get previous boolean state (false if first)
    const oldValue = this.cachedStatus ? this.getStatusValue(this.cachedStatus) : false;
    // Cache new status
    this.cachedStatus = status;
    const newValue = this.getStatusValue(status);
    // Always update on first run, or when the value changes
    if ((isFirst || newValue !== oldValue) && this.service) {
      this.service.updateCharacteristic(this.onChar, newValue);
    }
  }

  /**
   * Handle requests to get the current value of the "On" characteristic.
   */
  public handleGet(callback?: (error: Error | null, value?: boolean) => void): boolean {
    this.platform.log.debug(`Triggered GET ${this.logPrefix}`);

    // Use only in-memory cachedStatus for GET
    const isOn = this.cachedStatus ? this.getStatusValue(this.cachedStatus) : false;
    
    if (callback) {
      callback(null, isOn);
    }
    return isOn;
  }

  /**
   * Handle request to set the "On" characteristic
   */
  protected async handleSet(value: CharacteristicValue, callback?: CharacteristicSetCallback): Promise<void> {
    this.platform.log.debug(`Triggered SET ${this.logPrefix}: ${value}`);

    try {
      // Convert the value to boolean
      const boolValue = value === true || value === 1;
      
      // Call the provided API function to change the state
      await this.setApiState(boolValue);
      
      // Don't clear cache manually - let the centralized status update handle it
      
      if (callback && typeof callback === 'function') {
        callback(null);
      }
    } catch (error) {
      this.platform.log.error(`Error setting ${this.logPrefix} for ${this.accessory.displayName}`, error);
      if (callback && typeof callback === 'function') {
        callback(error as Error);
      }
    }
  }
}
