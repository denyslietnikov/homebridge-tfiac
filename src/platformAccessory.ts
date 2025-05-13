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
import { DeviceState } from './state/DeviceState.js';

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
  private boundHandleDeviceStateChanged: (state: DeviceState) => void; // To store bound listener

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

    this.cacheManager = CacheManager.getInstance(deviceConfig); // Pass only deviceConfig
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
      this.platform.log.info(
        `Temperature sensors are disabled for ${deviceConfig.name} - removing any that were cached.`,
      );

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

    this.deviceStateInstance = this.cacheManager.getDeviceState(); // Use getter
    this.boundHandleDeviceStateChanged = this.handleDeviceStateChanged.bind(this);
    this.deviceStateInstance.on('stateChanged', this.boundHandleDeviceStateChanged);

    this.setupCharacteristicHandlers();

    this.handleDeviceStateChanged(this.deviceStateInstance);

    this.startPolling();
  }

  private handleDeviceStateChanged(state: DeviceState): void {
    this.platform.log.debug(`[${this.deviceConfig.name}] DeviceState changed, updating HeaterCooler characteristics.`);
    const apiStatus = state.toApiStatus(); // Returns AirConditionerStatus with temps in Fahrenheit
    this.updateHeaterCoolerCharacteristics(apiStatus);
    this.indoorTemperatureSensorAccessory?.updateStatus(apiStatus);
    this.outdoorTemperatureSensorAccessory?.updateStatus(apiStatus);
    this.iFeelSensorAccessory?.updateStatus(apiStatus);
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
    const correction = typeof this.deviceConfig.temperatureCorrection === 'number' ? this.deviceConfig.temperatureCorrection : 0;
    if (status) {
      this.platform.log.debug(
        `[${this.deviceConfig.name}] Updating characteristics: Pw ${status.is_on}, Mode ${status.operation_mode}, Target ${status.target_temp}`,
      );
      const activeValue = status.is_on === PowerState.On
        ? this.platform.Characteristic.Active.ACTIVE
        : this.platform.Characteristic.Active.INACTIVE;
      this.service.updateCharacteristic(this.platform.Characteristic.Active, activeValue);

      const currentHCState = this.mapAPICurrentModeToHomebridgeCurrentMode(
        status.operation_mode as OperationMode,
        status.is_on as PowerState, 
        status.target_temp, 
        status.current_temp, 
      );
      this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState, currentHCState);

      let targetHCState: number;
      if (this.lastTargetOperation === OperationMode.Auto && status.operation_mode === OperationMode.Auto) {
        targetHCState = this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
      } else {
        targetHCState = this.mapAPIModeToHomebridgeMode(status.operation_mode as OperationMode);
      }
      this.service.updateCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState, targetHCState);

      const currentTempCelsius = fahrenheitToCelsius(status.current_temp) + correction;
      this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, currentTempCelsius);

      const targetTempCelsius = fahrenheitToCelsius(status.target_temp);
      this.service.updateCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature, targetTempCelsius);
      this.service.updateCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature, targetTempCelsius);

      const fanSpeedPercent = this.calculateFanRotationSpeed(status.fan_mode as FanSpeed, status.opt_turbo, status.opt_sleepMode as SleepModeState);
      this.service.updateCharacteristic(this.platform.Characteristic.RotationSpeed, fanSpeedPercent);

      const swingModeValue = status.swing_mode === SwingMode.Off
        ? this.platform.Characteristic.SwingMode.SWING_DISABLED
        : this.platform.Characteristic.SwingMode.SWING_ENABLED;
      this.service.updateCharacteristic(this.platform.Characteristic.SwingMode, swingModeValue);

    } else {
      this.platform.log.warn(`[${this.deviceConfig.name}] updateHeaterCoolerCharacteristics received null status. Setting to default/idle.`);
      this.service.updateCharacteristic(this.platform.Characteristic.Active, this.platform.Characteristic.Active.INACTIVE);
      this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState, this.platform.Characteristic.CurrentHeaterCoolerState.IDLE);
      this.service.updateCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState, this.platform.Characteristic.TargetHeaterCoolerState.AUTO);
      this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, 20 + correction);
      this.service.updateCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature, 22);
      this.service.updateCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature, 22);
      this.service.updateCharacteristic(this.platform.Characteristic.RotationSpeed, 0);
      this.service.updateCharacteristic(this.platform.Characteristic.SwingMode, this.platform.Characteristic.SwingMode.SWING_DISABLED);
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
      }
    }
  }

  private async handleCurrentHeaterCoolerStateGet(): Promise<CharacteristicValue> {
    this.platform.log.debug(`[${this.deviceConfig.name}] GET CurrentHeaterCoolerState`);
    const deviceState = this.cacheManager.getDeviceState();
    const apiStatus = deviceState.toApiStatus(); 

    const state = this.mapAPICurrentModeToHomebridgeCurrentMode(
      apiStatus.operation_mode as OperationMode,
      apiStatus.is_on as PowerState, 
      apiStatus.target_temp, 
      apiStatus.current_temp, 
    );
    return state;
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
    const deviceState = this.cacheManager.getDeviceState(); // Use getter
    const apiStatus = deviceState.toApiStatus();
    const correction = typeof this.deviceConfig.temperatureCorrection === 'number' ? this.deviceConfig.temperatureCorrection : 0;
    const tempCelsius = fahrenheitToCelsius(apiStatus.current_temp) + correction;
    return tempCelsius;
  }

  private async handleThresholdTemperatureGet(): Promise<CharacteristicValue> {
    this.platform.log.debug(`[${this.deviceConfig.name}] GET ThresholdTemperature`);
    const deviceState = this.cacheManager.getDeviceState(); // Use getter
    const apiStatus = deviceState.toApiStatus();
    const tempCelsius = fahrenheitToCelsius(apiStatus.target_temp);
    return tempCelsius;
  }

  private async handleThresholdTemperatureSet(
    value: CharacteristicValue,
    callback?: CharacteristicSetCallback,
  ): Promise<void> {
    const temperatureCelsius = value as number;
    this.platform.log.info(`[${this.deviceConfig.name}] SET ThresholdTemperature to: ${temperatureCelsius}°C`);
    try {
      const deviceState = this.cacheManager.getDeviceState(); // Use getter
      const desiredState = deviceState.clone();
      desiredState.setTargetTemperature(temperatureCelsius);

      await this.cacheManager.applyStateToDevice(desiredState);

      if (callback && typeof callback === 'function') {
        callback(null);
      }
    } catch (error) {
      this.platform.log.error(`[${this.deviceConfig.name}] Error setting ThresholdTemperature: ${error}`);
      if (callback && typeof callback === 'function') {
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
    const fanMode = this.mapRotationSpeedToAPIFanMode(speedPercent);
    this.platform.log.info(`[${this.deviceConfig.name}] SET RotationSpeed to ${speedPercent}% (mapped to: ${fanMode})`);
    try {
      const deviceState = this.cacheManager.getDeviceState(); // Use getter
      const desiredState = deviceState.clone();
      desiredState.setFanSpeed(fanMode);
      desiredState.setTurboMode(PowerState.Off);
      desiredState.setSleepMode(SleepModeState.Off);

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
    const swingModeValue = apiStatus.swing_mode === SwingMode.Off
      ? this.platform.Characteristic.SwingMode.SWING_DISABLED
      : this.platform.Characteristic.SwingMode.SWING_ENABLED;
    return swingModeValue;
  }

  private async handleSwingModeSet(
    value: CharacteristicValue,
    callback?: CharacteristicSetCallback,
  ): Promise<void> {
    const swingEnabled = value === this.platform.api.hap.Characteristic.SwingMode.SWING_ENABLED;
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
    for (const key in FanSpeedPercentMap) {
      if (FanSpeedPercentMap[key as FanSpeed] === speed) {
        return key as FanSpeed;
      }
    }
    if (speed === 0) {
      return FanSpeed.Auto;
    }
    if (speed < FanSpeedPercentMap[FanSpeed.Silent]) { // 1-14
      return FanSpeed.Silent;
    }
    if (speed < FanSpeedPercentMap[FanSpeed.Low]) { // 15-29
      return FanSpeed.Silent;
    }
    if (speed < FanSpeedPercentMap[FanSpeed.MediumLow]) { // 30-44
      return FanSpeed.Low;
    }
    if (speed < FanSpeedPercentMap[FanSpeed.Medium]) { // 45-59
      return FanSpeed.MediumLow;
    }
    if (speed < FanSpeedPercentMap[FanSpeed.MediumHigh]) { // 60-74
      return FanSpeed.Medium;
    }
    if (speed < FanSpeedPercentMap[FanSpeed.High]) { // 75-89
      return FanSpeed.MediumHigh;
    }
    if (speed < FanSpeedPercentMap[FanSpeed.Turbo]) { // 90-99
      return FanSpeed.High;
    }
    return FanSpeed.Turbo; // 100+
  }

  // Mapping functions for HeaterCooler states
  private mapAPICurrentModeToHomebridgeCurrentMode(
    mode: OperationMode,
    power: PowerState,
    targetTempF: number,
    currentTempF: number,
  ): number {
    if (power === PowerState.Off) {
      return this.platform.Characteristic.CurrentHeaterCoolerState.IDLE;
    }
    switch (mode) {
    case OperationMode.Cool:
      return this.platform.Characteristic.CurrentHeaterCoolerState.COOLING;
    case OperationMode.Heat:
      return this.platform.Characteristic.CurrentHeaterCoolerState.HEATING;
    case OperationMode.Auto:
    case OperationMode.SelfFeel:
      if (currentTempF > targetTempF) {
        return this.platform.Characteristic.CurrentHeaterCoolerState.COOLING;
      } else if (currentTempF < targetTempF) {
        return this.platform.Characteristic.CurrentHeaterCoolerState.HEATING;
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
}