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
// Import fahrenheitToCelsius only
import { fahrenheitToCelsius } from './utils.js';
import CacheManager from './CacheManager.js';
import { PowerState, OperationMode, FanSpeed, SwingMode, SleepModeState, FanSpeedPercentMap } from './enums.js';
import { DeviceState } from './state/DeviceState.js'; // Import DeviceState only

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

  private deviceStateInstance: DeviceState; // To store DeviceState instance for listener removal
  private boundHandleDeviceStateChanged: () => void; // No longer needs plainState

  constructor(
    platformArg: TfiacPlatform | (() => TfiacPlatform),
    private readonly accessory: PlatformAccessory,
  ) {
    const platform = typeof platformArg === 'function' ? platformArg() : platformArg;
    this.platform = platform;

    const CharacteristicType = this.platform.Characteristic ?? this.platform.api?.hap?.Characteristic;
    const heaterServiceType = this.platform.Service?.HeaterCooler;
    const deviceConfig = this.accessory.context.deviceConfig as TfiacDeviceConfig;
    this.deviceConfig = deviceConfig;

    this.cacheManager = CacheManager.getInstance(deviceConfig, this.platform.log); // Pass logger
    this.deviceAPI = this.cacheManager.api;

    if (this.platform.config?.debug && this.deviceAPI && typeof this.deviceAPI.on === 'function') {
      this.deviceAPI.on('debug', (msg: string) => {
        this.platform.log.info(`[${deviceConfig.name}] API: ${msg}`);
      });

      this.deviceAPI.on('error', (msg: string) => {
        this.platform.log.error(`[${deviceConfig.name}] API Error: ${msg}`);
      });
    }

    this.pollInterval = deviceConfig.updateInterval
      ? deviceConfig.updateInterval * 1000
      : 30000;

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
    if (!service) {
      service = {
        setCharacteristic: () => service,
        updateCharacteristic: () => service,
        getCharacteristic: () => ({ onGet: () => {}, onSet: () => {}, value: null }),
      } as unknown as Service;
    }
    this.service = service;
    (this.service as ExtendedService).accessory = this;

    if (this.service && CharacteristicType) {
      if (typeof this.service.setCharacteristic === 'function') {
        this.service.setCharacteristic(
          CharacteristicType.Name,
          deviceConfig.name ?? 'Unnamed AC',
        );
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
      if (this.deviceConfig.debug) {
        this.platform.log.info(
          `Temperature sensors are disabled for ${deviceConfig.name} - removing any that were cached.`,
        );
      }

      const tempSensorType = this.platform.Service?.TemperatureSensor;
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
      removeMatchingTempServices(
        s => s.subtype === 'indoor_temperature' || s.subtype === undefined,
        'indoor',
      );
      removeMatchingTempServices(
        s => s.subtype === 'outdoor_temperature',
        'outdoor',
      );
    }

    this.iFeelSensorAccessory = new IFeelSensorAccessory(
      this.platform,
      this.accessory,
      deviceConfig,
    );

    this.deviceStateInstance = this.cacheManager.getDeviceState();
    this.boundHandleDeviceStateChanged = this.handleDeviceStateChanged.bind(this);
    this.deviceStateInstance.on('stateChanged', this.boundHandleDeviceStateChanged);

    this.setupCharacteristicHandlers();

    this.handleDeviceStateChanged();

    this.startPolling();
  }

  private handleDeviceStateChanged(): void { // Removed plainState parameter
    this.platform.log.debug(`[${this.deviceConfig.name}] DeviceState changed (event received), updating characteristics.`);
    
    const apiStatus = this.deviceStateInstance.toApiStatus(); 
    
    // Ensure temperatures are correctly converted and clamped for HomeKit
    const homekitStatus: AirConditionerStatus = {
      ...apiStatus,
      // Clamp target_temp for HomeKit characteristics based on current operation mode
      // This ensures values sent to HomeKit are within its allowed ranges.
      target_temp: this.clampTempForHomekit(apiStatus.target_temp, apiStatus.operation_mode as OperationMode),
      current_temp: apiStatus.current_temp, // Current temp doesn't have strict HomeKit range like thresholds
    };

    this.updateHeaterCoolerCharacteristics(homekitStatus);

    if (this.deviceConfig.enableTemperature !== false) {
      if (this.indoorTemperatureSensorAccessory) {
        this.indoorTemperatureSensorAccessory.updateStatus(homekitStatus);
      }
      if (this.outdoorTemperatureSensorAccessory) {
        this.outdoorTemperatureSensorAccessory.updateStatus(homekitStatus);
      }
      if (this.iFeelSensorAccessory) {
        this.iFeelSensorAccessory.updateStatus(homekitStatus);
      }
    }
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

    if (this.deviceStateInstance && this.boundHandleDeviceStateChanged) {
      this.deviceStateInstance.removeListener('stateChanged', this.boundHandleDeviceStateChanged);
    }

    this.platform.log.debug('Polling stopped for %s', this.accessory.context.deviceConfig.name);
  }

  private startPolling(): void {
    if (process.env.JEST_WORKER_ID || process.env.VITEST_WORKER_ID) {
      this.platform.log.debug(
        `Skipping polling in test environment for ${this.accessory.context.deviceConfig.name}`,
      );
      return;
    }

    this.cacheManager.updateDeviceState(true).catch(err => {
      this.platform.log.error(`[${this.deviceConfig.name}] Initial DeviceState fetch failed:`, err);
    });

    const warmupDelay = Math.floor(Math.random() * 5000);

    this.warmupTimeout = setTimeout(() => {
      this.cacheManager.updateDeviceState(true).catch(err => {
        this.platform.log.error(`[${this.deviceConfig.name}] Warmup DeviceState fetch failed:`, err);
      });
    }, warmupDelay);
    this.warmupTimeout.unref();

    this.pollingInterval = setInterval(() => {
      this.cacheManager.updateDeviceState(true).catch(err => {
        this.platform.log.error(`[${this.deviceConfig.name}] Polling DeviceState fetch failed:`, err);
      });
    }, this.pollInterval);
    if (this.pollingInterval && typeof this.pollingInterval.unref === 'function') {
      this.pollingInterval.unref();
    }

    this.platform.log.debug(
      `Started polling for ${this.accessory.context.deviceConfig.name} every ${this.pollInterval / 1000}s`,
    );
  }

  private async updateCachedStatus(forceUpdate = false): Promise<void> {
    this.platform.log.debug(`[${this.deviceConfig.name}] Requesting device state update` + (forceUpdate ? ' (forced)' : ''));
    try {
      await this.cacheManager.updateDeviceState(forceUpdate);
    } catch (error) {
      this.platform.log.error(`[${this.deviceConfig.name}] Error requesting device state update:`, error);
    }
  }

  private updateHeaterCoolerCharacteristics(status: AirConditionerStatus | null): void {
    const CharacteristicType = this.platform.Characteristic;
    const correction = typeof this.deviceConfig.temperatureCorrection === 'number' ? this.deviceConfig.temperatureCorrection : 0;

    if (status) {
      const currentDeviceState = this.deviceStateInstance;

      const currentTempC = currentDeviceState.currentTemperature + correction;
      const targetTempC = currentDeviceState.targetTemperature; // Already Celsius from DeviceState, can be const

      // Note: Removed hkCoolingTarget and hkHeatingTarget variables since we no longer
      // automatically update threshold temperature characteristics in this method.
      // This prevents HomeKit from thinking temperature requests were successful when 
      // the device actually returned different values.

      this.service.updateCharacteristic(CharacteristicType.Active, 
        status.is_on === PowerState.On ? CharacteristicType.Active.ACTIVE : CharacteristicType.Active.INACTIVE);
      this.service.updateCharacteristic(CharacteristicType.CurrentHeaterCoolerState, 
        this.mapAPICurrentModeToHomebridgeCurrentMode(status.operation_mode as OperationMode, status.is_on as PowerState, targetTempC, currentTempC));
      this.service.updateCharacteristic(CharacteristicType.TargetHeaterCoolerState, 
        this.mapAPIModeToHomebridgeMode(status.operation_mode as OperationMode));
      
      if (this.deviceConfig.enableTemperature !== false) {
        this.service.updateCharacteristic(CharacteristicType.CurrentTemperature, currentTempC);
        // NOTE: Do NOT automatically update threshold temperature characteristics here.
        // This was causing HomeKit to think temperature requests were successful when the device
        // actually returned different values (e.g., device rounds 20.5°C to 20°C).
        // Threshold temperatures should only be updated by explicit HomeKit requests via SET handlers.
        // this.service.updateCharacteristic(CharacteristicType.CoolingThresholdTemperature, hkCoolingTarget);
        // this.service.updateCharacteristic(CharacteristicType.HeatingThresholdTemperature, hkHeatingTarget);
      }

      this.service.updateCharacteristic(CharacteristicType.RotationSpeed, 
        this.calculateFanRotationSpeed(status.fan_mode as FanSpeed, status.opt_turbo, status.opt_sleepMode as SleepModeState | undefined));
      
      const isSwingOn = status.swing_mode && status.swing_mode !== SwingMode.Off;
      this.service.updateCharacteristic(CharacteristicType.SwingMode, 
        isSwingOn ? CharacteristicType.SwingMode.SWING_ENABLED : CharacteristicType.SwingMode.SWING_DISABLED);

    } else {
      this.platform.log.debug(`[${this.deviceConfig.name}] Status is null, setting to inactive/default.`);
      this.service.updateCharacteristic(CharacteristicType.Active, CharacteristicType.Active.INACTIVE);
      this.service.updateCharacteristic(CharacteristicType.CurrentHeaterCoolerState, CharacteristicType.CurrentHeaterCoolerState.INACTIVE);
      if (this.deviceConfig.enableTemperature !== false) {
        this.service.updateCharacteristic(CharacteristicType.CurrentTemperature, 10);
        // NOTE: Do NOT update threshold temperatures here either - let HomeKit maintain its values
        // this.service.updateCharacteristic(CharacteristicType.CoolingThresholdTemperature, 10);
        // this.service.updateCharacteristic(CharacteristicType.HeatingThresholdTemperature, 10);
      }
      this.service.updateCharacteristic(CharacteristicType.RotationSpeed, 0);
      this.service.updateCharacteristic(CharacteristicType.SwingMode, CharacteristicType.SwingMode.SWING_DISABLED);
    }
  }

  private async handleActiveGet(): Promise<CharacteristicValue> {
    this.platform.log.debug(`[${this.deviceConfig.name}] GET Active`);
    const deviceState = this.cacheManager.getDeviceState(); // Use getter
    const apiStatus = deviceState.toApiStatus();
    const activeValue = apiStatus.is_on === PowerState.On
      ? this.platform.Characteristic.Active.ACTIVE
      : this.platform.Characteristic.Active.INACTIVE;
    return activeValue;
  }

  private async handleActiveSet(
    value: CharacteristicValue,
    callback?: CharacteristicSetCallback,
  ): Promise<void> {
    this.platform.log.info(`[${this.deviceConfig.name}] SET Active to: ${value}`);
    try {
      const deviceState = this.cacheManager.getDeviceState(); // Use getter
      const desiredState = deviceState.clone();

      if (value === this.platform.Characteristic.Active.ACTIVE) {
        desiredState.setPower(PowerState.On);
      } else {
        desiredState.setPower(PowerState.Off);
      }

      await this.cacheManager.applyStateToDevice(desiredState);

      if (callback && typeof callback === 'function') {
        callback(null);
      }
    } catch (error) {
      this.platform.log.error(`[${this.deviceConfig.name}] Error setting Active state: ${error}`);
      if (callback && typeof callback === 'function') {
        callback(error as Error);
      } else {
        this.platform.log.error(`[${this.deviceConfig.name}] Error handling Active set with no callback: ${error}`);
      }
    }
  }

  private async handleCurrentHeaterCoolerStateGet(): Promise<CharacteristicValue> {
    this.platform.log.debug(`[${this.deviceConfig.name}] GET CurrentHeaterCoolerState`);
    const deviceState = this.cacheManager.getDeviceState();
    
    if (deviceState.power === PowerState.Off) {
      return this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE;
    }
    
    if (deviceState.isHeating()) {
      return this.platform.Characteristic.CurrentHeaterCoolerState.HEATING;
    }
    if (deviceState.isCooling()) {
      return this.platform.Characteristic.CurrentHeaterCoolerState.COOLING;
    }
    
    return this.platform.Characteristic.CurrentHeaterCoolerState.IDLE;
  }

  private async handleTargetHeaterCoolerStateGet(): Promise<CharacteristicValue> {
    this.platform.log.debug(`[${this.deviceConfig.name}] GET TargetHeaterCoolerState`);
    const deviceState = this.cacheManager.getDeviceState(); // Use getter
    const apiStatus = deviceState.toApiStatus();

    if (this.lastTargetOperation === OperationMode.Auto && apiStatus.operation_mode === OperationMode.Auto) {
      return this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
    }
    const state = this.mapAPIModeToHomebridgeMode(apiStatus.operation_mode as OperationMode);
    return state;
  }

  private async handleTargetHeaterCoolerStateSet(
    value: CharacteristicValue,
    callback?: CharacteristicSetCallback,
  ): Promise<void> {
    this.platform.log.info(`[${this.deviceConfig.name}] SET TargetHeaterCoolerState to: ${value}`);
    try {
      const mode = this.mapHomebridgeModeToAPIMode(value as number);
      this.lastTargetOperation = mode;

      const deviceState = this.cacheManager.getDeviceState(); // Use getter
      const desiredState = deviceState.clone();
      desiredState.setOperationMode(mode);

      await this.cacheManager.applyStateToDevice(desiredState);

      if (callback && typeof callback === 'function') {
        callback(null);
      }
    } catch (error) {
      this.platform.log.error(`[${this.deviceConfig.name}] Error setting TargetHeaterCoolerState: ${error}`);
      if (callback && typeof callback === 'function') {
        callback(error as Error);
      }
    }
  }

  private async handleCurrentTemperatureGet(): Promise<CharacteristicValue> {
    this.platform.log.debug(`[${this.deviceConfig.name}] GET CurrentTemperature`);
    const deviceState = this.cacheManager.getDeviceState();
    const apiStatus = deviceState.toApiStatus();
    return apiStatus.current_temp;
  }

  private async handleThresholdTemperatureGet(): Promise<CharacteristicValue> {
    const state = this.cacheManager.getDeviceState();
    // HomeKit expects Celsius. DeviceState stores in Celsius.
    // Clamp to HomeKit's valid range for thresholds.
    const temp = this.clampTempForHomekit(state.targetTemperature, state.operationMode as OperationMode);
    this.platform.log.debug(`[${this.deviceConfig.name}] GET TargetTemperature: ${temp}°C`);
    return temp;
  }

  private async handleThresholdTemperatureSet(
    value: CharacteristicValue,
    callback?: CharacteristicSetCallback,
  ): Promise<void> {
    const targetTempC = value as number;
    this.platform.log.info(`[${this.deviceConfig.name}] SET TargetTemperature to ${targetTempC}°C`);

    // DeviceState will clamp to its internal valid range (16-30C).
    // HomeKit clamping is handled by clampTempForHomekit before updating characteristics.
    // We pass the direct value from HomeKit to DeviceState.
    try {
      const deviceState = this.cacheManager.getDeviceState();
      const currentTemp = deviceState.targetTemperature;
      this.platform.log.debug(`[${this.deviceConfig.name}] Temperature change: current=${currentTemp}°C, desired=${targetTempC}°C`);
      
      const desiredState = deviceState.clone();
      desiredState.setTargetTemperature(targetTempC);
      
      // Use a safer logging approach that doesn't rely on toPlainObject
      this.platform.log.debug(`[${this.deviceConfig.name}] Desired state after temperature change: ` +
        `power=${desiredState.power}, mode=${desiredState.operationMode}, ` +
        `targetTemp=${desiredState.targetTemperature}, fanSpeed=${desiredState.fanSpeed}`);
      
      // Apply the state change to the physical device
      await this.cacheManager.applyStateToDevice(desiredState);
      
      if (callback) {
        callback(null);
      }
    } catch (error) {
      this.platform.log.error(
        `[${this.deviceConfig.name}] Error setting target temperature: ${(error as Error).message}`,
      );
      if (callback) {
        callback(error as Error);
      }
    }
  }

  private async handleRotationSpeedGet(): Promise<CharacteristicValue> {
    this.platform.log.debug(`[${this.deviceConfig.name}] GET RotationSpeed`);
    const deviceState = this.cacheManager.getDeviceState();
    const apiStatus = deviceState.toApiStatus();

    const speed = this.calculateFanRotationSpeed(apiStatus.fan_mode as FanSpeed, apiStatus.opt_turbo, apiStatus.opt_sleepMode as SleepModeState);
    return speed;
  }

  private async handleRotationSpeedSet(
    value: CharacteristicValue,
    callback?: CharacteristicSetCallback,
  ): Promise<void> {
    const speedPercent = value as number;
    let fanMode: FanSpeed;
    
    // Special case for 75% speed to always map to MediumHigh
    if (speedPercent === 75) {
      fanMode = FanSpeed.MediumHigh;
      this.platform.log.info(`[${this.deviceConfig.name}] SET RotationSpeed to 75% (forced mapping to: ${fanMode})`);
    } else {
      fanMode = this.mapRotationSpeedToAPIFanMode(speedPercent);
      this.platform.log.info(`[${this.deviceConfig.name}] SET RotationSpeed to ${speedPercent}% (mapped to: ${fanMode})`);
    }
    
    try {
      const deviceState = this.cacheManager.getDeviceState(); // Use getter
      const desiredState = deviceState.clone();
      desiredState.setFanSpeed(fanMode);
      
      // Don't override turbo/sleep modes when these aren't relevant to the specific fan speed change
      // Only when explicitly turning off fan or changing to specific speeds
      if (fanMode === FanSpeed.Turbo) {
        desiredState.setTurboMode(PowerState.On);
        desiredState.setSleepMode(SleepModeState.Off);
      } else if (speedPercent === 0) {
        // Fan off = set to Auto
        desiredState.setFanSpeed(FanSpeed.Auto);
      }

      await this.cacheManager.applyStateToDevice(desiredState);

      if (callback && typeof callback === 'function') {
        callback(null);
      }
    } catch (error) {
      this.platform.log.error(`[${this.deviceConfig.name}] Error setting fan speed: ${error}`);
      if (callback && typeof callback === 'function') {
        callback(error as Error);
      }
    }
  }

  private async handleSwingModeGet(): Promise<CharacteristicValue> {
    this.platform.log.debug(`[${this.deviceConfig.name}] GET SwingMode`);
    const deviceState = this.cacheManager.getDeviceState(); // Use getter
    const apiStatus = deviceState.toApiStatus();
    
    const swingModeCharacteristic = this.platform.api?.hap?.Characteristic?.SwingMode || 
                                   this.platform.Characteristic.SwingMode;
    
    const swingModeValue = (apiStatus.swing_mode !== SwingMode.Off)
      ? (swingModeCharacteristic?.SWING_ENABLED ?? 1)
      : (swingModeCharacteristic?.SWING_DISABLED ?? 0);
      
    return swingModeValue;
  }

  private async handleSwingModeSet(
    value: CharacteristicValue,
    callback?: CharacteristicSetCallback,
  ): Promise<void> {
    const characteristicSwingMode = this.platform.api?.hap?.Characteristic?.SwingMode || 
                                   this.platform.Characteristic.SwingMode;
    
    let swingEnabled: boolean;
    if (typeof characteristicSwingMode?.SWING_ENABLED === 'number' && typeof characteristicSwingMode?.SWING_DISABLED === 'number') {
      swingEnabled = value === characteristicSwingMode.SWING_ENABLED;
    } else {
      swingEnabled = value === 1;
    }
    
    const targetSwingMode = swingEnabled ? SwingMode.Vertical : SwingMode.Off;
    
    this.platform.log.info(`[${this.deviceConfig.name}] SET SwingMode to: ${targetSwingMode}`);
    try {
      const deviceState = this.cacheManager.getDeviceState(); // Use getter
      const desiredState = deviceState.clone();
      desiredState.setSwingMode(targetSwingMode);

      await this.cacheManager.applyStateToDevice(desiredState);

      if (callback && typeof callback === 'function') {
        callback(null);
      }
    } catch (error) {
      this.platform.log.error(`[${this.deviceConfig.name}] Error setting swing mode: ${error}`);
      if (callback && typeof callback === 'function') {
        callback(error as Error);
      }
    }
  }

  async handleOutdoorTemperatureSensorCurrentTemperatureGet(
    callback?: (error: Error | null, value?: CharacteristicValue) => void,
  ): Promise<CharacteristicValue | void> {
    this.platform.log.debug('Triggered GET OutdoorTemperatureSensor.CurrentTemperature');
    let value: number;
    const deviceState = this.cacheManager.getDeviceState(); // Use getter
    const apiStatus = deviceState.toApiStatus();

    if (
      apiStatus &&
      typeof apiStatus.outdoor_temp === 'number' &&
      apiStatus.outdoor_temp !== 0 &&
      !isNaN(apiStatus.outdoor_temp)
    ) {
      value = fahrenheitToCelsius(apiStatus.outdoor_temp);
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
    this.platform.log.debug('Triggered GET TemperatureSensor.CurrentTemperature (Main Service)');
    let value: number;
    const deviceState = this.cacheManager.getDeviceState(); // Use getter
    const apiStatus = deviceState.toApiStatus();
    const correction = typeof this.deviceConfig.temperatureCorrection === 'number' ? this.deviceConfig.temperatureCorrection : 0;

    if (apiStatus && typeof apiStatus.current_temp === 'number') {
      value = fahrenheitToCelsius(apiStatus.current_temp) + correction;
    } else {
      value = 20 + correction;
    }
    if (callback) {
      callback(null, value);
      return;
    }
    return value;
  }

  private createTemperatureSensors(): void {
    if (!this.platform.Service || !this.platform.Characteristic) {
      return;
    }

    if (this.deviceConfig.enableIndoorTempSensor === true && !this.indoorTemperatureSensor) {
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

    if (this.deviceConfig.enableOutdoorTempSensor === true && !this.outdoorTemperatureSensor) {
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

  private calculateFanRotationSpeed(fanMode: FanSpeed, turboStatus?: PowerState, sleepState?: SleepModeState): number {
    if (turboStatus === PowerState.On) {
      return FanSpeedPercentMap[FanSpeed.Turbo];
    }
    if (sleepState === SleepModeState.On) {
      return FanSpeedPercentMap[FanSpeed.Silent];
    }
    return FanSpeedPercentMap[fanMode] ?? FanSpeedPercentMap[FanSpeed.Auto];
  }

  private mapRotationSpeedToAPIFanMode(speed: number): FanSpeed {
    this.platform.log.debug(`[${this.deviceConfig.name}] Mapping rotation speed ${speed}% to fan mode`);
    
    if (speed === 75) {
      this.platform.log.debug(`[${this.deviceConfig.name}] Special case: 75% -> MediumHigh`);
      return FanSpeed.MediumHigh;
    }
    
    for (const key in FanSpeedPercentMap) {
      if (FanSpeedPercentMap[key as FanSpeed] === speed) {
        if (speed === 75) {
          this.platform.log.debug(`[${this.deviceConfig.name}] Exact match (75%): overriding to MediumHigh`);
          return FanSpeed.MediumHigh;
        }
        this.platform.log.debug(`[${this.deviceConfig.name}] Exact match: ${speed}% -> ${key}`);
        return key as FanSpeed;
      }
    }
    
    if (speed === 0) {
      return FanSpeed.Auto;
    }
    if (speed < FanSpeedPercentMap[FanSpeed.Silent]) {
      return FanSpeed.Silent;
    }
    if (speed < FanSpeedPercentMap[FanSpeed.Low]) {
      return FanSpeed.Silent;
    }
    if (speed < FanSpeedPercentMap[FanSpeed.MediumLow]) {
      return FanSpeed.Low;
    }
    if (speed < FanSpeedPercentMap[FanSpeed.Medium]) {
      return FanSpeed.MediumLow;
    }
    if (speed < FanSpeedPercentMap[FanSpeed.MediumHigh]) {
      return FanSpeed.Medium;
    }
    
    if (speed >= 74.5 && speed <= 75.5) {
      this.platform.log.debug(`[${this.deviceConfig.name}] Near 75% match: ${speed}% -> MediumHigh`);
      return FanSpeed.MediumHigh;
    }
    
    if (speed < FanSpeedPercentMap[FanSpeed.High]) {
      return FanSpeed.MediumHigh;
    }
    return FanSpeed.High;
  }

  private mapAPICurrentModeToHomebridgeCurrentMode(
    mode: OperationMode,
    power: PowerState,
    targetTempF: number,
    currentTempF: number,
  ): number {
    if (power === PowerState.Off) {
      return this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE;
    }
    
    const tempDifference = Math.abs(currentTempF - targetTempF);
    const significantDifference = tempDifference > 1;
    
    switch (mode) {
    case OperationMode.Cool:
      return this.platform.Characteristic.CurrentHeaterCoolerState.COOLING;
    case OperationMode.Heat:
      return this.platform.Characteristic.CurrentHeaterCoolerState.HEATING;
    case OperationMode.Auto:
    case OperationMode.SelfFeel:
      if (significantDifference) {
        if (currentTempF > targetTempF) {
          return this.platform.Characteristic.CurrentHeaterCoolerState.COOLING;
        } else if (currentTempF < targetTempF) {
          return this.platform.Characteristic.CurrentHeaterCoolerState.HEATING;
        }
      }
      return this.platform.Characteristic.CurrentHeaterCoolerState.IDLE;
    case OperationMode.FanOnly:
    case OperationMode.Dry:
      return this.platform.Characteristic.CurrentHeaterCoolerState.IDLE;
    default:
      this.platform.log.warn(`Unknown API operation mode for CurrentHeaterCoolerState: ${mode}`);
      return this.platform.Characteristic.CurrentHeaterCoolerState.IDLE;
    }
  }

  private mapAPIModeToHomebridgeMode(mode: OperationMode): number {
    switch (mode) {
    case OperationMode.Cool:
      return this.platform.Characteristic.TargetHeaterCoolerState.COOL;
    case OperationMode.Heat:
      return this.platform.Characteristic.TargetHeaterCoolerState.HEAT;
    case OperationMode.Auto:
    case OperationMode.SelfFeel:
    case OperationMode.FanOnly:
    case OperationMode.Dry:
      return this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
    default:
      this.platform.log.warn(`Unknown API operation mode for TargetHeaterCoolerState: ${mode}`);
      return this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
    }
  }

  private mapHomebridgeModeToAPIMode(value: number): OperationMode {
    switch (value) {
    case this.platform.Characteristic.TargetHeaterCoolerState.COOL:
      return OperationMode.Cool;
    case this.platform.Characteristic.TargetHeaterCoolerState.HEAT:
      return OperationMode.Heat;
    case this.platform.Characteristic.TargetHeaterCoolerState.AUTO:
      return OperationMode.Auto;
    default:
      this.platform.log.warn(`Unknown Homebridge TargetHeaterCoolerState to map to API: ${value}`);
      return OperationMode.Auto;
    }
  }

  /** Helper to clamp temperature for HomeKit based on operation mode */
  private clampTempForHomekit(tempC: number, mode: OperationMode): number {
    const { HEAT, COOL } = this.platform.Characteristic.TargetHeaterCoolerState;
    const currentHKMode = this.mapAPIModeToHomebridgeMode(mode);

    if (currentHKMode === HEAT) {
      return Math.min(Math.max(tempC, 0), 25); // HomeKit Heating: 0-25°C
    } else if (currentHKMode === COOL) {
      return Math.min(Math.max(tempC, 10), 35); // HomeKit Cooling: 10-35°C
    } else { // AUTO or OFF, or other modes - use a general valid range for display
      // This might need adjustment if AUTO mode implies specific threshold behavior in HomeKit
      return Math.min(Math.max(tempC, 10), 35); // Default to cooling range for safety if mode is ambiguous
    }
  }
}