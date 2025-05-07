// platformAccessory.ts

import {
  PlatformAccessory,
  Service,
  CharacteristicValue,
  CharacteristicSetCallback,
} from 'homebridge';
// Import Characteristic as a type only
import type { Characteristic, WithUUID } from 'homebridge';
import type { TfiacPlatform } from './platform.js';
import AirConditionerAPI, { AirConditionerStatus } from './AirConditionerAPI.js';
import { TfiacDeviceConfig } from './settings.js';
import { IndoorTemperatureSensorAccessory } from './IndoorTemperatureSensorAccessory.js';
import { OutdoorTemperatureSensorAccessory } from './OutdoorTemperatureSensorAccessory.js';
import { IFeelSensorAccessory } from './IFeelSensorAccessory.js';
import { fahrenheitToCelsius, celsiusToFahrenheit } from './utils.js';
import CacheManager from './CacheManager.js';
import { PowerState, OperationMode, FanSpeed, FanSpeedPercentMap, SwingMode } from './enums.js';

export interface CharacteristicHandlers {
  get?: () => Promise<CharacteristicValue>;
  set?: (value: CharacteristicValue, callback: CharacteristicSetCallback) => void;
}

// Define interface for extended service to avoid using 'any'
interface ExtendedService extends Service {
  accessory?: TfiacPlatformAccessory;
}

export class TfiacPlatformAccessory {
  private readonly platform: TfiacPlatform;
  private service: Service;
  private deviceAPI: AirConditionerAPI;
  private cachedStatus: AirConditionerStatus | null = null; // Explicitly typed
  private pollInterval: number;
  private pollingInterval: NodeJS.Timeout | null = null; // Store interval reference
  private warmupTimeout: NodeJS.Timeout | null = null; // Store warmup timeout reference
  private cacheManager: CacheManager;

  private indoorTemperatureSensorAccessory: IndoorTemperatureSensorAccessory | null = null;
  private outdoorTemperatureSensorAccessory: OutdoorTemperatureSensorAccessory | null = null;
  private iFeelSensorAccessory: IFeelSensorAccessory | null = null;
  
  // Properties used for temperature sensors
  private indoorTemperatureSensor: IndoorTemperatureSensorAccessory | null = null;
  private outdoorTemperatureSensor: OutdoorTemperatureSensorAccessory | null = null;

  private characteristicHandlers: Map<string, CharacteristicHandlers> = new Map();

  private deviceConfig: TfiacDeviceConfig;

  private lastTargetOperation: OperationMode | null = null;

  constructor(
    platformArg: TfiacPlatform | (() => TfiacPlatform),
    private readonly accessory: PlatformAccessory,
  ) {
    // Normalize platform: if a factory function is passed, call it
    const platform = typeof platformArg === 'function' ? platformArg() : platformArg;
    this.platform = platform;

    // Determine Characteristic type (use only platform's Characteristic implementation)
    const CharacteristicType = this.platform.Characteristic ?? this.platform.api?.hap?.Characteristic;
    // Use platform-provided service constructors
    const heaterServiceType = this.platform.Service?.HeaterCooler;
    const deviceConfig = this.accessory.context.deviceConfig as TfiacDeviceConfig;
    this.deviceConfig = deviceConfig;

    this.cacheManager = CacheManager.getInstance(deviceConfig);
    // Shared API instance for all accessory services
    this.deviceAPI = this.cacheManager.api;

    this.pollInterval = deviceConfig.updateInterval
      ? deviceConfig.updateInterval * 1000
      : 30000;

    // Initialize service: try existing, then add, then fallback for tests
    let service: Service | undefined;
    if (heaterServiceType) {
      service = this.accessory.getService?.(heaterServiceType);
      if (!service) {
        service = this.accessory.addService?.(heaterServiceType, deviceConfig.name);
      }
    }
    if (!service && this.accessory.services && this.accessory.services.length > 0) {
      service = this.accessory.services[0] as Service;
    }
    // Fallback to minimal mock service for test environments
    if (!service) {
      service = {
        setCharacteristic: () => service,
        updateCharacteristic: () => service,
        getCharacteristic: () => ({ onGet: () => {}, onSet: () => {}, value: null }),
      } as unknown as Service;
    }
    this.service = service;
    // Link service to this accessory instance for getHandlerByIdentifier support
    (this.service as ExtendedService).accessory = this;

    // Only set characteristics if they exist and the methods exist
    if (this.service && CharacteristicType) {
      if (typeof this.service.setCharacteristic === 'function') {
        this.service.setCharacteristic(
          CharacteristicType.Name,
          deviceConfig.name ?? 'Unnamed AC',
        );
        // Also set ConfiguredName for better display in Home app
        this.service.setCharacteristic(
          CharacteristicType.ConfiguredName,
          deviceConfig.name ?? 'Unnamed AC',
        );
      } else if (typeof this.service.updateCharacteristic === 'function') {
        this.service.updateCharacteristic(
          CharacteristicType.Name,
          deviceConfig.name ?? 'Unnamed AC',
        );
      }
    }

    const enableTemperature = deviceConfig.enableTemperature !== false;

    if (enableTemperature) {
      this.indoorTemperatureSensorAccessory = new IndoorTemperatureSensorAccessory(
        this.platform,
        this.accessory,
        deviceConfig,
      );
      this.outdoorTemperatureSensorAccessory = new OutdoorTemperatureSensorAccessory(
        this.platform,
        this.accessory,
        deviceConfig,
      );
    } else {
      // Temperature services are disabled in the user‑config
      this.platform.log.info(
        `Temperature sensors are disabled for ${deviceConfig.name} - removing any that were cached.`,
      );

      const tempSensorType = this.platform.Service?.TemperatureSensor;

      /** Helper that removes *all* TemperatureSensor services matching the supplied predicate */
      const removeMatchingTempServices = (predicate: (s: Service) => boolean, description: string): void => {
        if (!this.accessory.services || !tempSensorType) {
          return;
        }
        
        this.accessory.services
          .filter(s => s.UUID === tempSensorType.UUID && predicate(s))
          .forEach(s => {
            this.accessory.removeService(s);
            this.platform.log.debug(`Removed existing ${description} temperature sensor service.`);
          });
      };

      // ── Indoor ──────────────────────────────────────────────────────────────────────
      // Remove by explicit subtype *or* no subtype (legacy versions didn't set one).
      removeMatchingTempServices(
        s => s.subtype === 'indoor_temperature' || s.subtype === undefined,
        'indoor',
      );

      // ── Outdoor ─────────────────────────────────────────────────────────────────────
      removeMatchingTempServices(
        s => s.subtype === 'outdoor_temperature',
        'outdoor',
      );
    }

    // Initialize iFeel sensor regardless of temperature setting
    // It can be disabled separately with enableIFeelSensor
    this.iFeelSensorAccessory = new IFeelSensorAccessory(
      this.platform,
      this.accessory,
      deviceConfig,
    );

    this.startPolling();

    this.setupCharacteristicHandlers();
  }

  private setupCharacteristicHandlers(): void {
    this.setupCharacteristic(
      'Active', 
      this.handleActiveGet.bind(this),
      this.handleActiveSet.bind(this),
    );

    this.setupCharacteristic(
      'CurrentHeaterCoolerState',
      this.handleCurrentHeaterCoolerStateGet.bind(this),
    );

    this.setupCharacteristic(
      'TargetHeaterCoolerState',
      this.handleTargetHeaterCoolerStateGet.bind(this),
      this.handleTargetHeaterCoolerStateSet.bind(this),
    );

    this.setupCharacteristic(
      'CurrentTemperature',
      this.handleCurrentTemperatureGet.bind(this),
    );

    this.setupCharacteristic(
      'CoolingThresholdTemperature',
      this.handleThresholdTemperatureGet.bind(this),
      this.handleThresholdTemperatureSet.bind(this),
    );

    this.setupCharacteristic(
      'HeatingThresholdTemperature',
      this.handleThresholdTemperatureGet.bind(this),
      this.handleThresholdTemperatureSet.bind(this),
    );

    this.setupCharacteristic(
      'RotationSpeed',
      this.handleRotationSpeedGet.bind(this),
      this.handleRotationSpeedSet.bind(this),
    );

    this.setupCharacteristic(
      'SwingMode',
      this.handleSwingModeGet.bind(this),
      this.handleSwingModeSet.bind(this),
    );
  }

  private setupCharacteristic(
    characteristic: string | WithUUID<new () => Characteristic>,
    getHandler: () => Promise<CharacteristicValue>,
    setHandler?: (value: CharacteristicValue, callback: CharacteristicSetCallback) => void,
  ): void {
    const handlers: CharacteristicHandlers = { get: getHandler };
    if (setHandler) {
      handlers.set = setHandler;
    }
    const charId = typeof characteristic === 'string' ? characteristic : characteristic.UUID;
    this.characteristicHandlers.set(charId, handlers);

    try {
      // Resolve characteristic type if a string key was passed
      const characteristicType = typeof characteristic === 'string'
        ? (this.platform.Characteristic as unknown as Record<string, WithUUID<new () => Characteristic>>)[characteristic]
        : characteristic;
      const char = this.service.getCharacteristic(characteristicType);
      
      if (char) {
        if (getHandler && typeof char.on === 'function') {
          char.onGet(getHandler);
        }
        
        if (setHandler && typeof char.on === 'function') {
          char.onSet(setHandler);
        }
      }
    } catch (error) {
      this.platform.log.debug(`Could not set up characteristic ${charId}: ${error}`);
    }
  }

  getCharacteristicHandler(characteristicName: string, eventType: 'get' | 'set'):
    | (() => Promise<CharacteristicValue>)
    | ((value: CharacteristicValue, callback: CharacteristicSetCallback) => void)
    | ((callback: (error: Error | null, value?: CharacteristicValue) => void) => void)
    | undefined {
    const handlers = this.characteristicHandlers.get(characteristicName);
    if (handlers) {
      if (eventType === 'get' && handlers.get) {
        return (callback: (error: Error | null, value?: CharacteristicValue) => void): void => {
          handlers.get!()
            .then((value: CharacteristicValue) => callback(null, value))
            .catch((error: Error) => callback(error));
        };
      }
      if (eventType === 'set' && handlers.set) {
        return handlers.set.bind(this);
      }
    }

    let raw:
      | (() => Promise<CharacteristicValue>)
      | ((value: CharacteristicValue, callback: CharacteristicSetCallback) => void)
      | undefined;
    if (characteristicName === 'CurrentTemperature' && eventType === 'get') {
      raw = this.handleCurrentTemperatureGet.bind(this);
    } else if (
      (characteristicName === 'CoolingThresholdTemperature' || characteristicName === 'HeatingThresholdTemperature') &&
      eventType === 'get'
    ) {
      raw = this.handleThresholdTemperatureGet.bind(this);
    } else if (
      (characteristicName === 'CoolingThresholdTemperature' || characteristicName === 'HeatingThresholdTemperature') &&
      eventType === 'set'
    ) {
      raw = this.handleThresholdTemperatureSet.bind(this);
    } else if (characteristicName === 'RotationSpeed' && eventType === 'get') {
      raw = this.handleRotationSpeedGet.bind(this);
    } else if (characteristicName === 'RotationSpeed' && eventType === 'set') {
      raw = this.handleRotationSpeedSet.bind(this);
    } else if (characteristicName === 'SwingMode' && eventType === 'get') {
      raw = this.handleSwingModeGet.bind(this);
    } else if (characteristicName === 'SwingMode' && eventType === 'set') {
      raw = this.handleSwingModeSet.bind(this);
    } else if (characteristicName === 'Active' && eventType === 'get') {
      raw = this.handleActiveGet.bind(this);
    } else if (characteristicName === 'Active' && eventType === 'set') {
      raw = this.handleActiveSet.bind(this);
    } else if (characteristicName === 'CurrentHeaterCoolerState' && eventType === 'get') {
      raw = this.handleCurrentHeaterCoolerStateGet.bind(this);
    } else if (characteristicName === 'TargetHeaterCoolerState' && eventType === 'get') {
      raw = this.handleTargetHeaterCoolerStateGet.bind(this);
    } else if (characteristicName === 'TargetHeaterCoolerState' && eventType === 'set') {
      raw = this.handleTargetHeaterCoolerStateSet.bind(this);
    }
    if (raw) {
      if (eventType === 'get') {
        // Assert that raw is the 'get' handler type here
        const getHandler = raw as () => Promise<CharacteristicValue>;
        return (callback: (error: Error | null, value?: CharacteristicValue) => void): void => {
          getHandler() // Call the correctly typed handler
            .then((value: CharacteristicValue) => callback(null, value))
            .catch((error: Error) => callback(error));
        };
      }
      // If eventType is 'set', raw must be the 'set' handler type
      return raw as (value: CharacteristicValue, callback: CharacteristicSetCallback) => void;
    }
    return undefined;
  }

  public stopPolling(): void {
    if (this.warmupTimeout) {
      clearTimeout(this.warmupTimeout);
      this.warmupTimeout = null;
    }
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    if (this.deviceAPI) {
      this.deviceAPI.cleanup();
    }

    this.platform.log.debug('Polling stopped for %s', this.accessory.context.deviceConfig.name);
  }

  private startPolling(): void {
    // Skip polling in test environment to avoid leaking timers
    if (process.env.JEST_WORKER_ID || process.env.VITEST_WORKER_ID) {
      this.platform.log.debug(
        `Skipping polling in test environment for ${this.accessory.context.deviceConfig.name}`,
      );
      return;
    }
    
    // Do an initial update before starting the timers
    this.updateCachedStatus().catch(err => {
      this.platform.log.error('Initial state fetch failed:', err);
    });

    const warmupDelay = Math.floor(Math.random() * 5000); // Reduced from 10s to 5s

    this.warmupTimeout = setTimeout(() => {
      this.updateCachedStatus().catch(err => {
        this.platform.log.error('Initial state fetch failed:', err);
      });
    }, warmupDelay);
    this.warmupTimeout.unref();

    this.pollingInterval = setInterval(() => {
      this.updateCachedStatus().catch(err => {
        this.platform.log.error('Polling state fetch failed:', err);
      });
    }, this.pollInterval);
    this.pollingInterval.unref();
    
    this.platform.log.debug(
      `Started polling for ${this.accessory.context.deviceConfig.name} every ${this.pollInterval/1000}s`,
    );
  }

  private async updateCachedStatus(): Promise<void> {
    try {
      // Fetch fresh status directly from device API
      const status = await this.deviceAPI.updateState();
      this.cachedStatus = status;
      this.platform.log.debug('Fetched status from API:', status);

      this.updateHeaterCoolerCharacteristics(status);

      this.indoorTemperatureSensorAccessory?.updateStatus(status);
      this.outdoorTemperatureSensorAccessory?.updateStatus(status);
      this.iFeelSensorAccessory?.updateStatus(status);
      // Emit centralized status to subscribers
      this.cacheManager.api.emit('status', status);

    } catch (error) {
      this.platform.log.error('Error updating cached status:', error);
      this.updateHeaterCoolerCharacteristics(null);
      this.indoorTemperatureSensorAccessory?.updateStatus(null);
      this.outdoorTemperatureSensorAccessory?.updateStatus(null);
      this.iFeelSensorAccessory?.updateStatus(null);
      // Notify subscribers of null status on error
      this.cacheManager.api.emit('status', null);
    }
  }

  private updateHeaterCoolerCharacteristics(status: AirConditionerStatus | null): void {
    const correction = typeof this.deviceConfig.temperatureCorrection === 'number' ? this.deviceConfig.temperatureCorrection : 0;
    if (status) {
      const activeValue = status.is_on === PowerState.On
        ? this.platform.Characteristic.Active.ACTIVE
        : this.platform.Characteristic.Active.INACTIVE;
      this.service.updateCharacteristic(this.platform.Characteristic.Active, activeValue);

      const currentHCState = this.mapOperationModeToCurrentHeaterCoolerState(status.operation_mode as OperationMode);
      this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState, currentHCState);
      let targetHCState: number;
      if (this.lastTargetOperation === OperationMode.Auto) {
        targetHCState = this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
      } else {
        targetHCState = this.mapOperationModeToTargetHeaterCoolerState(status.operation_mode as OperationMode);
      }
      this.service.updateCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState, targetHCState);

      const currentTempCelsius = fahrenheitToCelsius(status.current_temp) + correction;
      this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, currentTempCelsius);

      const targetTempCelsius = fahrenheitToCelsius(status.target_temp);
      this.service.updateCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature, targetTempCelsius);
      this.service.updateCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature, targetTempCelsius);

      const fanSpeed = this.mapFanModeToRotationSpeed(status.fan_mode as FanSpeed);
      this.service.updateCharacteristic(this.platform.Characteristic.RotationSpeed, fanSpeed);

      const swingMode = status.swing_mode === SwingMode.Off ? 0 : 1;
      this.service.updateCharacteristic(this.platform.Characteristic.SwingMode, swingMode);

    } else {
      this.service.updateCharacteristic(this.platform.Characteristic.Active, this.platform.Characteristic.Active.INACTIVE);
      this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState, this.platform.Characteristic.CurrentHeaterCoolerState.IDLE);
      this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, 20 + correction);
      this.service.updateCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature, 22);
      this.service.updateCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature, 22);
      this.service.updateCharacteristic(this.platform.Characteristic.RotationSpeed, 50);
      this.service.updateCharacteristic(this.platform.Characteristic.SwingMode, 0);
    }
  }

  private async handleActiveGet(): Promise<CharacteristicValue> {
    this.platform.log.debug('Triggered GET Active');
    
    if (this.cachedStatus) {
      const activeValue = this.cachedStatus.is_on === PowerState.On
        ? this.platform.Characteristic.Active.ACTIVE
        : this.platform.Characteristic.Active.INACTIVE;
      return activeValue;
    }
    
    const currentValue = this.service.getCharacteristic(this.platform.Characteristic.Active)!.value;
    return currentValue ?? this.platform.Characteristic.Active.INACTIVE;
  }

  private async handleActiveSet(
    value: CharacteristicValue,
    callback?: CharacteristicSetCallback,
  ): Promise<void> {
    this.platform.log.debug('Triggered SET Active:', value);
    try {
      if (value === this.platform.Characteristic.Active.ACTIVE) {
        // Skip sending turnOn if device is already on to avoid duplicate beeps
        if (this.cachedStatus?.is_on === PowerState.On) {
          this.platform.log.debug('ActiveSet skipped: device already on');
        } else {
          await this.deviceAPI.turnOn();
        }
      } else {
        await this.deviceAPI.turnOff();
      }
      this.cacheManager.clear();
      await this.updateCachedStatus();
      if (callback && typeof callback === 'function') {
        callback(null);
      }
    } catch (error) {
      this.platform.log.error('Error setting Active state:', error);
      if (callback && typeof callback === 'function') {
        callback(error as Error);
      }
    }
  }

  private async handleCurrentHeaterCoolerStateGet(): Promise<CharacteristicValue> {
    this.platform.log.debug('Triggered GET CurrentHeaterCoolerState');
    
    if (this.cachedStatus) {
      const state = this.mapOperationModeToCurrentHeaterCoolerState(this.cachedStatus.operation_mode as OperationMode);
      return state;
    }
    
    if (this.cachedStatus === null) {
      return this.platform.Characteristic.CurrentHeaterCoolerState.IDLE;
    }
    
    const currentValue = this.service.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)!.value;
    return currentValue ?? this.platform.Characteristic.CurrentHeaterCoolerState.IDLE;
  }

  private async handleTargetHeaterCoolerStateGet(): Promise<CharacteristicValue> {
    this.platform.log.debug('Triggered GET TargetHeaterCoolerState');
    
    if (this.cachedStatus) {
      const state = this.mapOperationModeToTargetHeaterCoolerState(this.cachedStatus.operation_mode as OperationMode);
      return state;
    }
    
    if (this.cachedStatus === null) {
      return this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
    }
    
    const currentValue = this.service.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)!.value;
    return currentValue ?? this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
  }

  private async handleTargetHeaterCoolerStateSet(
    value: CharacteristicValue,
    callback?: CharacteristicSetCallback,
  ): Promise<void> {
    this.platform.log.debug('Triggered SET TargetHeaterCoolerState:', value);
    try {
      const mode = this.mapTargetHeaterCoolerStateToOperationMode(value as number);
      this.lastTargetOperation = mode;
      await this.deviceAPI.setAirConditionerState('operation_mode', mode);
      this.cacheManager.clear();
      await this.updateCachedStatus();
      if (callback && typeof callback === 'function') {
        callback(null);
      }
    } catch (error) {
      this.platform.log.error('Error setting TargetHeaterCoolerState:', error);
      if (callback && typeof callback === 'function') {
        callback(error as Error);
      }
    }
  }

  private async handleCurrentTemperatureGet(): Promise<CharacteristicValue> {
    this.platform.log.debug('Triggered GET CurrentTemperature');
    const correction = typeof this.deviceConfig.temperatureCorrection === 'number' ? this.deviceConfig.temperatureCorrection : 0;
    if (this.cachedStatus && typeof this.cachedStatus.current_temp === 'number') {
      const tempCelsius = fahrenheitToCelsius(this.cachedStatus.current_temp) + correction;
      return tempCelsius;
    }
    if (this.cachedStatus === null) {
      return 20 + correction;
    }
    const currentValue = this.service.getCharacteristic('CurrentTemperature')!.value;
    // Ensure currentValue is a number before adding correction
    const baseValue = typeof currentValue === 'number' ? currentValue : 20;
    return baseValue + correction;
  }

  private async handleThresholdTemperatureGet(): Promise<CharacteristicValue> {
    this.platform.log.debug('Triggered GET ThresholdTemperature');
    
    if (this.cachedStatus && typeof this.cachedStatus.target_temp === 'number') {
      const tempCelsius = fahrenheitToCelsius(this.cachedStatus.target_temp);
      return tempCelsius;
    }
    
    if (this.cachedStatus === null) {
      return 22;
    }
    
    const currentValue = this.service.getCharacteristic('CoolingThresholdTemperature')!.value;
    return currentValue ?? 22;
  }

  private async handleThresholdTemperatureSet(
    value: CharacteristicValue,
    callback?: CharacteristicSetCallback,
  ): Promise<void> {
    this.platform.log.debug('Triggered SET ThresholdTemperature:', value);
    const temperatureFahrenheit = celsiusToFahrenheit(value as number);
    try {
      await this.deviceAPI.setAirConditionerState('target_temp', temperatureFahrenheit.toString());
      this.cacheManager.clear();
      await this.updateCachedStatus(); // Refresh status after successful set
      if (callback && typeof callback === 'function') {
        callback(null);
      }
    } catch (error) {
      this.platform.log.error('Error setting ThresholdTemperature:', error);
      // Optionally refresh status even on failure, depending on desired behavior
      // await this.updateCachedStatus().catch(err => this.platform.log.error('Error refreshing status after failed set threshold:', err));
      if (callback && typeof callback === 'function') {
        callback(error as Error);
      }
    }
  }

  private async handleRotationSpeedGet(): Promise<CharacteristicValue> {
    this.platform.log.debug('Triggered GET RotationSpeed');
    if (this.cachedStatus === null) {
      return 50;
    }
    if (this.cachedStatus && typeof this.cachedStatus.fan_mode === 'string') {
      const speed = this.mapFanModeToRotationSpeed(this.cachedStatus.fan_mode as FanSpeed);
      return speed;
    }
    const currentValue = this.service.getCharacteristic('RotationSpeed')!.value;
    return currentValue ?? 50;
  }

  private async handleRotationSpeedSet(
    value: CharacteristicValue,
    callback?: CharacteristicSetCallback,
  ): Promise<void> {
    this.platform.log.debug('Triggered SET RotationSpeed:', value);
    const fanMode = this.mapRotationSpeedToFanMode(value as number);
    try {
      await this.deviceAPI.setFanSpeed(fanMode);
      this.cacheManager.clear();
      await this.updateCachedStatus(); // Refresh status after successful set
      if (callback && typeof callback === 'function') {
        callback(null);
      }
    } catch (error) {
      this.platform.log.error('Error setting fan speed:', error);
      // Optionally refresh status even on failure
      // await this.updateCachedStatus().catch(err => this.platform.log.error('Error refreshing status after failed set fan:', err));
      if (callback && typeof callback === 'function') {
        callback(error as Error);
      }
    }
  }

  private async handleSwingModeGet(): Promise<CharacteristicValue> {
    this.platform.log.debug('Triggered GET SwingMode');
    if (this.cachedStatus === null) {
      return 0;
    }
    if (this.cachedStatus && typeof this.cachedStatus.swing_mode === 'string') {
      const swingMode = this.cachedStatus.swing_mode === SwingMode.Off ? 0 : 1;
      return swingMode;
    }
    const currentValue = this.service.getCharacteristic('SwingMode')!.value;
    return currentValue ?? 0;
  }

  private async handleSwingModeSet(
    value: CharacteristicValue,
    callback?: CharacteristicSetCallback,
  ): Promise<void> {
    this.platform.log.debug('Triggered SET SwingMode:', value);
    const mode = value === this.platform.api.hap.Characteristic.SwingMode.SWING_ENABLED ? SwingMode.Vertical : SwingMode.Off; // Use Vertical instead of Both
    try {
      await this.deviceAPI.setSwingMode(mode);
      this.cacheManager.clear();
      await this.updateCachedStatus(); // Refresh status after successful set
      if (callback && typeof callback === 'function') {
        callback(null);
      }
    } catch (error) {
      this.platform.log.error('Error setting swing mode:', error);
      // Optionally refresh status even on failure
      // await this.updateCachedStatus().catch(err => this.platform.log.error('Error refreshing status after failed set swing:', err));
      if (callback && typeof callback === 'function') {
        callback(error as Error);
      }
    }
  }

  private mapOperationModeToCurrentHeaterCoolerState(mode: OperationMode): number {
    const { CurrentHeaterCoolerState } = this.platform.Characteristic;
    switch (mode) {
    case OperationMode.Cool:
      return CurrentHeaterCoolerState.COOLING;
    case OperationMode.Heat:
      return CurrentHeaterCoolerState.HEATING;
    default:
      return CurrentHeaterCoolerState.IDLE;
    }
  }

  private mapOperationModeToTargetHeaterCoolerState(mode: OperationMode): number {
    const { TargetHeaterCoolerState } = this.platform.Characteristic;
    switch (mode) {
    case OperationMode.Cool:
      return TargetHeaterCoolerState.COOL;
    case OperationMode.Heat:
      return TargetHeaterCoolerState.HEAT;
    case OperationMode.Dry:
    case OperationMode.FanOnly:
    case OperationMode.Auto:
    default:
      return TargetHeaterCoolerState.AUTO;
    }
  }

  private mapTargetHeaterCoolerStateToOperationMode(state: number): OperationMode {
    const { TargetHeaterCoolerState } = this.platform.Characteristic;
    switch (state) {
    case TargetHeaterCoolerState.COOL:
      return OperationMode.Cool;
    case TargetHeaterCoolerState.HEAT:
      return OperationMode.Heat;
    default:
      return OperationMode.Auto;
    }
  }

  private mapFanModeToRotationSpeed(fanMode: FanSpeed): number {
    // Use FanSpeedPercentMap for all supported fan modes
    return FanSpeedPercentMap[fanMode] ?? 50;
  }

  private mapRotationSpeedToFanMode(speed: number): FanSpeed {
    let nearestMode: FanSpeed = FanSpeed.Auto;
    let minDiff = Infinity;
    for (const [mode, percent] of Object.entries(FanSpeedPercentMap) as [FanSpeed, number][]) {
      const diff = Math.abs(speed - percent);
      if (diff < minDiff) {
        minDiff = diff;
        nearestMode = mode;
      }
    }
    return nearestMode;
  }

  private convertTemperatureToDisplay(value: number, displayUnits: number): number {
    const { TemperatureDisplayUnits } = this.platform.api.hap.Characteristic;
    return displayUnits === TemperatureDisplayUnits.FAHRENHEIT
      ? celsiusToFahrenheit(value)
      : value;
  }

  private convertTemperatureFromDisplay(value: number, displayUnits: number): number {
    const { TemperatureDisplayUnits } = this.platform.api.hap.Characteristic;
    return displayUnits === TemperatureDisplayUnits.FAHRENHEIT
      ? fahrenheitToCelsius(value)
      : value;
  }

  private mapHomebridgeModeToAPIMode(state: number): OperationMode { // Return OperationMode
    const { TargetHeaterCoolerState } = this.platform.api.hap.Characteristic;
    switch (state) {
    case TargetHeaterCoolerState.HEAT:
      return OperationMode.Heat;
    case TargetHeaterCoolerState.COOL:
      return OperationMode.Cool;
    default:
      return OperationMode.Auto;
    }
  }

  private mapAPIModeToHomebridgeMode(mode: OperationMode | string): number { // Accept OperationMode
    const { TargetHeaterCoolerState } = this.platform.api.hap.Characteristic;
    switch (mode) {
    case OperationMode.Heat:
      return TargetHeaterCoolerState.HEAT;
    case OperationMode.Cool:
      return TargetHeaterCoolerState.COOL;
    case OperationMode.Dry:
    case OperationMode.FanOnly:
    case OperationMode.Auto:
    default:
      return TargetHeaterCoolerState.AUTO;
    }
  }

  private mapAPIActiveToHomebridgeActive(state: PowerState): number { // Accept PowerState
    const { Active } = this.platform.api.hap.Characteristic;
    return state === PowerState.On ? Active.ACTIVE : Active.INACTIVE;
  }

  private mapAPICurrentModeToHomebridgeCurrentMode(
    mode: OperationMode | string, // Accept OperationMode
    powerState?: PowerState, // Accept PowerState
    targetTemp?: number,
    currentTemp?: number,
  ): number {
    const { CurrentHeaterCoolerState } = this.platform.api.hap.Characteristic;
    if (mode === OperationMode.Heat) {
      return CurrentHeaterCoolerState.HEATING;
    }
    if (mode === OperationMode.Cool) {
      return CurrentHeaterCoolerState.COOLING;
    }
    if (mode === OperationMode.Auto) {
      if (powerState !== PowerState.On) {
        return CurrentHeaterCoolerState.IDLE;
      }
      if (typeof targetTemp !== 'number' || typeof currentTemp !== 'number') {
        return CurrentHeaterCoolerState.IDLE;
      }
      const targetC = fahrenheitToCelsius(targetTemp);
      const currentC = fahrenheitToCelsius(currentTemp);

      if (targetC > currentC) {
        return CurrentHeaterCoolerState.HEATING;
      }
      if (targetC < currentC) {
        return CurrentHeaterCoolerState.COOLING;
      }
      return CurrentHeaterCoolerState.IDLE;
    }
    if (mode === OperationMode.Dry) {
      return CurrentHeaterCoolerState.COOLING;
    }
    if (mode === OperationMode.FanOnly) {
      return CurrentHeaterCoolerState.IDLE;
    }
    return CurrentHeaterCoolerState.IDLE;
  }

  fahrenheitToCelsius(fahrenheit: number): number {
    return fahrenheitToCelsius(fahrenheit);
  }

  celsiusToFahrenheit(celsius: number): number {
    return celsiusToFahrenheit(celsius);
  }

  async handleOutdoorTemperatureSensorCurrentTemperatureGet(
    callback?: (error: Error | null, value?: CharacteristicValue) => void,
  ): Promise<CharacteristicValue | void> {
    this.platform.log.debug('Triggered GET OutdoorTemperatureSensor.CurrentTemperature');
    let value: number;
    if (
      this.cachedStatus &&
      typeof this.cachedStatus.outdoor_temp === 'number' &&
      this.cachedStatus.outdoor_temp !== 0 &&
      !isNaN(this.cachedStatus.outdoor_temp)
    ) {
      value = fahrenheitToCelsius(this.cachedStatus.outdoor_temp);
    } else {
      value = 20;
    }
    if (callback) {
      callback(null, value);
      return;
    }
    return value;
  }

  async handleTemperatureSensorCurrentTemperatureGet(
    callback?: (error: Error | null, value?: CharacteristicValue) => void,
  ): Promise<CharacteristicValue | void> {
    this.platform.log.debug('Triggered GET TemperatureSensor.CurrentTemperature');
    let value: number;
    if (this.cachedStatus && typeof this.cachedStatus.current_temp === 'number') {
      value = fahrenheitToCelsius(this.cachedStatus.current_temp);
    } else {
      value = 20;
    }
    if (callback) {
      callback(null, value);
      return;
    }
    return value;
  }

  /**
   * Create services for temperature sensors if enabled in config
   */
  private createTemperatureSensors(): void {
    // Skip if no platform services (in test environment)
    if (!this.platform.Service || !this.platform.Characteristic) {
      return;
    }

    if (this.deviceConfig.enableIndoorTempSensor === true) {
      try {
        this.indoorTemperatureSensor = new IndoorTemperatureSensorAccessory(
          this.platform,
          this.accessory,
          this.deviceConfig,
        );
      } catch (error) {
        this.platform.log.error('Failed to create indoor temperature sensor:', error);
      }
    }

    if (this.deviceConfig.enableOutdoorTempSensor === true) {
      try {
        this.outdoorTemperatureSensor = new OutdoorTemperatureSensorAccessory(
          this.platform,
          this.accessory,
          this.deviceConfig,
        );
      } catch (error) {
        this.platform.log.error('Failed to create outdoor temperature sensor:', error);
      }
    }
  }
}