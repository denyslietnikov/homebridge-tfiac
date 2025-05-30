/* eslint-disable @typescript-eslint/no-explicit-any */
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
import type { Logger } from 'homebridge';
import { DeviceState } from './state/DeviceState.js';

// Allow tests to override the CacheManager instance
declare global {
  // eslint-disable-next-line no-var
  var __mockCacheManagerInstance: CacheManager | undefined;
}

// Prefer named export, then default, then throw an error if no valid export is found
const CacheManagerClass =
  (CacheMgrModule as { CacheManager?: { getInstance: (config: TfiacDeviceConfig, logger?: Logger) => CacheManager } }).CacheManager ??
  (CacheMgrModule as { default?: { getInstance: (config: TfiacDeviceConfig, logger?: Logger) => CacheManager } }).default ??
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
  private static hasLoggedContext = false;
  protected readonly service: Service | undefined;
  private readonly nameChar: WithUUID<new () => Characteristic>;
  protected readonly onChar: WithUUID<new () => Characteristic>;
  protected readonly deviceConfig: TfiacDeviceConfig;
  protected isPolling = false;
  protected cacheManager: CacheManager;
  protected deviceState: DeviceState;
  private uiHoldUntil = 0; // Time in ms until which external state updates are ignored

  private stateChangeListener: (state: DeviceState) => void;

  constructor(
    protected readonly platform: TfiacPlatform,
    protected readonly accessory: PlatformAccessory,
    private readonly serviceName: string,
    private readonly serviceSubtype: string,
    private readonly getStatusValue: GetStatusValueFn,
    private readonly setApiState: SetApiStateFn,
    protected readonly logPrefix: string,
  ) {
    this.deviceConfig = accessory.context.deviceConfig;

    // Log context and config only once per device when debug is enabled
    if (this.deviceConfig?.debug && !BaseSwitchAccessory.hasLoggedContext) {
      console.log('BaseSwitchAccessory constructor starts', accessory.UUID || 'no-uuid');
      console.log('accessory context?', accessory.context || 'no-context');
      console.log('Using CacheManagerClass.getInstance');
      BaseSwitchAccessory.hasLoggedContext = true;
    }
    
    // Allow test override via accessory.context.cacheManager
     
    if ((accessory?.context as { cacheManager?: CacheManager }).cacheManager) {
      // Use cacheManager provided in accessory context (tests)
      this.cacheManager = (accessory.context as { cacheManager: CacheManager }).cacheManager;
    } else {
      const overrideCacheMgr = globalThis.__mockCacheManagerInstance;
      if (overrideCacheMgr) {
        this.cacheManager = overrideCacheMgr;
      } else {
        // Ensure this.deviceConfig is used here
        this.cacheManager = CacheManagerClass.getInstance(this.deviceConfig, this.platform.log);
        // Removed redundant debug log here (now only logs in the debug guard above)
      }
    }
    this.deviceState = this.cacheManager.getDeviceState();

    // Initialize characteristic types early
    this.nameChar = this.platform.Characteristic.Name;
    this.onChar = this.platform.Characteristic.On;

    this.stateChangeListener = this.handleStateChange.bind(this);

    // Try to reuse existing service or create a new one
    this.service =
      this.accessory.getServiceById(this.platform.Service.Switch.UUID, this.serviceSubtype) ||
      this.accessory.getService(this.serviceName);
    if (!this.service) {
      this.platform.log.info(`[${this.logPrefix}] Adding new Switch service: ${this.serviceName} (subtype: ${this.serviceSubtype})`);
      // Support both addService signatures (HAP and mock)
      if (this.accessory.addService.length >= 3) {
        // HAP addService(ServiceConstructor, name, subtype)
        this.service = this.accessory.addService(
          this.platform.Service.Switch,
          this.serviceName,
          this.serviceSubtype,
        );
      } else {
        // Mock addService(serviceInstance)
        // Service.Switch is a constructor, instantiate with new
        const serviceInstance = new this.platform.Service.Switch(this.serviceName, this.serviceSubtype);
        this.service = this.accessory.addService(serviceInstance);
      }
      if (!this.service) {
        this.platform.log.error(`[${this.logPrefix}] Failed to add Switch service: ${this.serviceName}. Accessory will not function correctly.`);
        throw new Error(`Service was added but is still null for ${this.serviceName}`);
      }
    }

    this.service.setCharacteristic(this.nameChar, this.serviceName);
    
    // Set ConfiguredName for better display in Home app
    if (typeof this.platform.Characteristic.ConfiguredName !== 'undefined') {
      this.service.setCharacteristic(
        this.platform.Characteristic.ConfiguredName,
        this.serviceName,
      );
    }

    this.service.getCharacteristic(this.onChar)
      .onGet(this.handleGet.bind(this))
      .onSet(this.handleSet.bind(this));

    // Patch accessory.getService to support constructor argument lookup for our service
    // Capture original getService method
    const origGetService = this.accessory.getService.bind(this.accessory);
    // Override getService to handle Service constructor lookup
    (this.accessory as any).getService = (identifier: any) => {
      return origGetService(identifier as any);
    };

    this.deviceState.on('stateChanged', this.stateChangeListener);

    this.platform.log.debug(`[${this.logPrefix}] Initializing state from DeviceState`);
    // Use handleStateChange to process and apply the initial state
    this.handleStateChange(this.deviceState);
  }

  /** Unsubscribe from centralized state change updates */
  public stopPolling(): void {
    this.deviceState.removeListener('stateChanged', this.stateChangeListener);
    this.platform.log.debug(`[${this.logPrefix}] Polling stopped and listeners removed.`);
  }

  /**
   * Handle state change events from the DeviceState
   */
  private handleStateChange(state: DeviceState): void {
    try {
      // Check if state is a valid DeviceState object with toApiStatus method
      if (!state || typeof state.toApiStatus !== 'function') {
        this.platform.log.warn(`[${this.logPrefix}] Invalid DeviceState object received, toApiStatus is not a function`);
        this._updateCharacteristicFromState(null);
        return;
      }

      const apiStatus = state.toApiStatus(); // Call toApiStatus only once

      if (apiStatus === null) {
        this.platform.log.warn(`[${this.logPrefix}] DeviceState provided null apiStatus. Passing null to _updateCharacteristicFromState.`);
        this._updateCharacteristicFromState(null); // _updateCharacteristicFromState is designed to handle null
        return;
      }

      // If apiStatus is not null, then proceed
      const relevantValue = this.getStatusValue(apiStatus);
      this.platform.log.debug(
        `[${this.logPrefix}] StateChanged. Power: ${state.power}, Val: ${relevantValue}, OpM: ${apiStatus.operation_mode}`,
      );
      this._updateCharacteristicFromState(apiStatus);
    } catch (error) {
      this.platform.log.error(`[${this.logPrefix}] Error in handleStateChange: ${error}`);
      this._updateCharacteristicFromState(null);
    }
  }

  /**
   * Fetches the latest status from the device API and updates DeviceState.
   * This method might be used for a manual refresh action.
   * The actual characteristic update happens via the 'stateChanged' event.
   */
  protected async updateCachedStatus(): Promise<void> {
    if (this.isPolling) {
      this.platform.log.debug(`[${this.logPrefix}] Polling already in progress for ${this.accessory.displayName}.`);
      return;
    }
    this.isPolling = true;
    this.platform.log.debug(`[${this.logPrefix}] Manually updating status for ${this.accessory.displayName}...`);

    try {
      await this.cacheManager.updateDeviceState(true); // force=true
    } catch (error) {
      this.platform.log.error(`[${this.logPrefix}] Error updating status for ${this.accessory.displayName}: ${error}`);
    } finally {
      this.isPolling = false;
    }
  }

  /** Update this switch based on centralized status. Now private. */
  private _updateCharacteristicFromState(status: Partial<AirConditionerStatus> | DeviceState | null): void {
    if (!this.service) {
      this.platform.log.warn(`[${this.logPrefix}] _updateCharacteristicFromState called but service is not available.`);
      return;
    }
    
    // Check if UI hold mode is active
    if (Date.now() < this.uiHoldUntil) {
      this.platform.log.debug(`[${this.logPrefix}] UI hold active, skip characteristic update.`);
      return;
    }

    // Convert input to a proper API status format
    let apiStatus: Partial<AirConditionerStatus> | null = null;
    if (status) {
      if ('toApiStatus' in status && typeof status.toApiStatus === 'function') {
        // Convert DeviceState to API status
        apiStatus = status.toApiStatus();
      } else {
        // Status is already in API format
        apiStatus = status as Partial<AirConditionerStatus>;
      }
    }

    // Determine the new value based on the API status
    // Default to false if status is null (e.g., device unavailable or initial state unknown)
    const newValue = apiStatus ? this.getStatusValue(apiStatus) : false;

    // Get the characteristic instance from the service to read its current value in HomeKit.
    const charInstance = this.service.getCharacteristic(this.onChar)!;
    const currentValue = (charInstance as unknown as { value: boolean }).value;

    // Use safe access for logging API status properties
    const powerState = apiStatus?.is_on;
    const opMode = apiStatus?.operation_mode;
    
    this.platform.log.debug(
      `[${this.logPrefix}] _updateCharacteristicFromState. Desired new value from DeviceState: ${newValue}, ` +
      `Current HomeKit characteristic value: ${currentValue}. ` +
      `Device power: ${powerState}, OpMode: ${opMode}`,
    );

    // Update the HomeKit characteristic only if the new value differs from the current characteristic value.
    if (newValue !== currentValue) {
      this.platform.log.info(
        `[${this.logPrefix}] Desired state ${newValue} differs from HomeKit characteristic ${currentValue}. Updating characteristic.`,
      );
      try {
        this.service.updateCharacteristic(this.onChar, newValue);
      } catch (error) {
        this.platform.log.error(`[${this.logPrefix}] Error setting state to ${newValue}: ${error}`);
      }
    } else {
      this.platform.log.debug(
        `[${this.logPrefix}] Desired state ${newValue} matches HomeKit characteristic. No characteristic update needed.`,
      );
    }
  }

  /**
   * Handle requests to get the current value of the "On" characteristic.
   */
  public handleGet(): CharacteristicValue { // Changed to return CharacteristicValue directly
    this.platform.log.debug(`[${this.logPrefix}] Triggered GET.`);
    if (!this.deviceState) {
      this.platform.log.warn(`[${this.logPrefix}] deviceState is null in handleGet, returning false`);
      return false;
    }
    const currentApiStatus = this.deviceState.toApiStatus();
    const isOn = currentApiStatus ? this.getStatusValue(currentApiStatus) : false;
    this.platform.log.debug(`[${this.logPrefix}] Current value for GET from DeviceState: ${isOn}`);
    return isOn;
  }

  /**
   * Handle request to set the "On" characteristic
   */
  protected async handleSet(value: CharacteristicValue, callback?: CharacteristicSetCallback): Promise<void> {
    this.platform.log.info(`[${this.logPrefix}] Triggered SET to: ${value}`);
    
    try {
      await this.setApiState(value as boolean);
      
      // Set UI hold time to prevent external updates only after successful operation
      this.uiHoldUntil = Date.now() + this.holdMs;
      this.platform.log.debug(`[${this.logPrefix}] UI hold set for ${this.holdMs}ms after successful operation`);
      
      // Start timer for automatic state update after UI hold period expires
      setTimeout(() => {
        this.platform.log.debug(`[${this.logPrefix}] UI hold period expired, forcing status update`);
        this.cacheManager.updateDeviceState(true); // Request current state
      }, this.holdMs + 200); // Adding a small buffer time
      
      if (typeof callback === 'function') {
        callback(null); // Success, HomeKit characteristic will update reactively
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Log and callback on failure, use consistent message format for BeepSwitchAccessory tests
      const failedMsg = `[${this.logPrefix}] Error setting state to ${value}: ${errorMessage}`;
      this.platform.log.error(failedMsg);
      
      // Clear any UI hold that might have been set, and immediately reset to current state
      this.uiHoldUntil = 0;
      
      // Only process callback if it is a function
      if (typeof callback === 'function') {
        // Wrap non-HapStatusError errors as HapStatusError for HomeKit (with status/hapStatus fields)
        let hapError: any;
        if (error instanceof this.platform.api.hap.HapStatusError) {
          hapError = error;
        } else {
          hapError = new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }
        // Attach status property for test compatibility
        hapError.status = this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE;
        this.platform.log.debug(
          `[${this.logPrefix}] HapError created with status: ${hapError.status}, hapStatus: ${hapError.hapStatus}`,
        );
        callback(hapError);
      }
      
      // Force immediate characteristic update to reflect actual device state
      setTimeout(() => {
        this.platform.log.debug(`[${this.logPrefix}] Forcing immediate state update after failed operation`);
        this.handleStateChange(this.deviceState);
      }, 100); // Small delay to ensure callback is processed first
    }
  }

  /**
   * Returns the UI hold time in milliseconds for the current service.
   * Takes into account settings from device config or platform.
   * @returns time in milliseconds
   */
  private get holdMs(): number {
    try {
      // Check service-specific settings
      const deviceCfg = this.deviceConfig?.uiHoldSeconds;
      
      if (typeof deviceCfg === 'object' && deviceCfg !== null) {
        // If there's a specific setting for this service type, use it
        const serviceKey = this.serviceName.toLowerCase();
        if (serviceKey in deviceCfg) {
          return deviceCfg[serviceKey] * 1000;
        }
      } else if (typeof deviceCfg === 'number') {
        // Use device-wide setting
        return deviceCfg * 1000;
      }
      
      // Use global platform setting or default
      const platformCfg = this.platform?.config?.uiHoldSeconds;
      return (typeof platformCfg === 'number' ? platformCfg : 30) * 1000;
    } catch (error) {
      // Fall back to default value for tests or if config is incomplete
      this.platform?.log?.debug?.(`[${this.logPrefix}] Error getting holdMs, using default: ${error}`);
      return 30 * 1000; // Default 30 seconds
    }
  }
}
