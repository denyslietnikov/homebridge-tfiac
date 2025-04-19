// platformAccessory.ts

import {
  PlatformAccessory,
  Service,
  CharacteristicValue,
  CharacteristicSetCallback,
  CharacteristicGetCallback,
} from 'homebridge';
import { TfiacPlatform } from './platform.js';
import AirConditionerAPI, { AirConditionerStatus } from './AirConditionerAPI.js';
import { TfiacDeviceConfig } from './settings.js';

export class TfiacPlatformAccessory {
  private service: Service;
  private turboService: Service;
  private temperatureSensorService: Service;
  private deviceAPI: AirConditionerAPI;
  private cachedStatus: AirConditionerStatus | null = null; // Explicitly typed
  private pollInterval: number;
  private pollingInterval: NodeJS.Timeout | null = null; // Store interval reference

  constructor(
    private readonly platform: TfiacPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // Retrieve the device config from the accessory context
    const deviceConfig = this.accessory.context.deviceConfig as TfiacDeviceConfig;

    // Create the AirConditionerAPI instance
    const ip = deviceConfig.ip;
    const port = deviceConfig.port ?? 7777;
    this.deviceAPI = new AirConditionerAPI(ip, port);

    // Determine polling interval (in milliseconds)
    this.pollInterval = deviceConfig.updateInterval
      ? deviceConfig.updateInterval * 1000
      : 30000;

    // Create or retrieve the HeaterCooler service
    this.service =
      this.accessory.getService(this.platform.Service.HeaterCooler) ||
      this.accessory.addService(this.platform.Service.HeaterCooler, deviceConfig.name);

    // Set the displayed name characteristic
    this.service.setCharacteristic(
      this.platform.Characteristic.Name,
      deviceConfig.name ?? 'Unnamed AC',
    );

    // --- Turbo Switch Service ---
    this.turboService =
      this.accessory.getService(this.platform.Service.Switch) ||
      this.accessory.addService(this.platform.Service.Switch);
    this.turboService.setCharacteristic(this.platform.Characteristic.Name, 'Turbo');
    this.turboService
      .getCharacteristic(this.platform.Characteristic.On)
      .on('get', this.handleTurboGet.bind(this))
      .on('set', this.handleTurboSet.bind(this));

    // --- Temperature Sensor Service ---
    this.temperatureSensorService =
      this.accessory.getService(this.platform.Service.TemperatureSensor) ||
      this.accessory.addService(this.platform.Service.TemperatureSensor, deviceConfig.name + ' Indoor Temp');
    this.temperatureSensorService.setCharacteristic(
      this.platform.Characteristic.Name,
      (deviceConfig.name ?? 'Unnamed AC') + ' Indoor Temp',
    );
    this.temperatureSensorService
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .on('get', this.handleTemperatureSensorCurrentTemperatureGet.bind(this));

    // Start background polling to update cached status
    this.startPolling();

    // Link handlers for required characteristics
    this.service
      .getCharacteristic(this.platform.Characteristic.Active)
      .on('get', this.handleActiveGet.bind(this))
      .on('set', this.handleActiveSet.bind(this));

    this.service
      .getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
      .on('get', this.handleCurrentHeaterCoolerStateGet.bind(this));

    this.service
      .getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
      .on('get', this.handleTargetHeaterCoolerStateGet.bind(this))
      .on('set', this.handleTargetHeaterCoolerStateSet.bind(this));

    this.service
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .on('get', this.handleCurrentTemperatureGet.bind(this));

    this.service
      .getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
      .on('get', this.handleThresholdTemperatureGet.bind(this))
      .on('set', this.handleThresholdTemperatureSet.bind(this));

    this.service
      .getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
      .on('get', this.handleThresholdTemperatureGet.bind(this))
      .on('set', this.handleThresholdTemperatureSet.bind(this));

    this.service
      .getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .on('get', this.handleRotationSpeedGet.bind(this))
      .on('set', this.handleRotationSpeedSet.bind(this));

    this.service
      .getCharacteristic(this.platform.Characteristic.SwingMode)
      .on('get', this.handleSwingModeGet.bind(this))
      .on('set', this.handleSwingModeSet.bind(this));
  }

  /**
   * Stop polling and clean up resources
   */
  public stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    
    // Clean up the API as well
    if (this.deviceAPI) {
      this.deviceAPI.cleanup();
    }
    
    this.platform.log.debug('Polling stopped for %s', this.accessory.context.deviceConfig.name);
  }

  /**
   * Starts periodic polling of the device state.
   */
  private startPolling(): void {
    // Immediately update cache
    this.updateCachedStatus();
    // Then schedule periodic updates
    this.pollingInterval = setInterval(() => {
      this.updateCachedStatus();
    }, this.pollInterval);
    // Ensure timer does not keep node process alive
    this.pollingInterval.unref();
  }

  /**
   * Updates the cached status by calling the device API.
   */
  private async updateCachedStatus(): Promise<void> {
    try {
      const status = await this.deviceAPI.updateState();
      this.cachedStatus = status;
      this.platform.log.debug('Cached status updated:', status);
      // Update TemperatureSensor characteristic
      if (this.temperatureSensorService && status) {
        const temperatureCelsius = this.fahrenheitToCelsius(status.current_temp);
        this.temperatureSensorService.updateCharacteristic(
          this.platform.Characteristic.CurrentTemperature,
          temperatureCelsius,
        );
      }
    } catch (error) {
      this.platform.log.error('Error updating cached status:', error);
    }
  }

  private handleActiveGet(callback: CharacteristicGetCallback): void {
    this.platform.log.debug('Triggered GET Active');
    if (this.cachedStatus) {
      const activeValue =
        this.cachedStatus.is_on === 'on'
          ? this.platform.Characteristic.Active.ACTIVE
          : this.platform.Characteristic.Active.INACTIVE;
      callback(null, activeValue);
    } else {
      callback(new Error('Cached status not available'));
    }
  }

  private async handleActiveSet(
    value: CharacteristicValue,
    callback: CharacteristicSetCallback,
  ): Promise<void> {
    this.platform.log.debug('Triggered SET Active:', value);
    try {
      if (value === this.platform.Characteristic.Active.ACTIVE) {
        await this.deviceAPI.turnOn();
      } else {
        await this.deviceAPI.turnOff();
      }
      // Optionally update cache immediately after setting state
      this.updateCachedStatus();
      callback(null);
    } catch (error) {
      this.platform.log.error('Error setting Active state:', error);
      callback(error as Error);
    }
  }

  private handleCurrentHeaterCoolerStateGet(callback: CharacteristicGetCallback): void {
    this.platform.log.debug('Triggered GET CurrentHeaterCoolerState');
    if (this.cachedStatus) {
      const state = this.mapOperationModeToCurrentHeaterCoolerState(
        this.cachedStatus.operation_mode,
      );
      callback(null, state);
    } else {
      callback(new Error('Cached status not available'));
    }
  }

  private handleTargetHeaterCoolerStateGet(callback: CharacteristicGetCallback): void {
    this.platform.log.debug('Triggered GET TargetHeaterCoolerState');
    if (this.cachedStatus) {
      const state = this.mapOperationModeToTargetHeaterCoolerState(
        this.cachedStatus.operation_mode,
      );
      callback(null, state);
    } else {
      callback(new Error('Cached status not available'));
    }
  }

  private async handleTargetHeaterCoolerStateSet(
    value: CharacteristicValue,
    callback: CharacteristicSetCallback,
  ): Promise<void> {
    this.platform.log.debug('Triggered SET TargetHeaterCoolerState:', value);
    try {
      const mode = this.mapTargetHeaterCoolerStateToOperationMode(value as number);
      await this.deviceAPI.setAirConditionerState('operation_mode', mode);
      // Update cache after setting
      this.updateCachedStatus();
      callback(null);
    } catch (error) {
      this.platform.log.error('Error setting TargetHeaterCoolerState:', error);
      callback(error as Error);
    }
  }

  private handleCurrentTemperatureGet(callback: CharacteristicGetCallback): void {
    this.platform.log.debug('Triggered GET CurrentTemperature');
    if (this.cachedStatus) {
      const temperatureCelsius = this.fahrenheitToCelsius(this.cachedStatus.current_temp);
      this.platform.log.debug(`Current temperature: ${temperatureCelsius}°C`);
      callback(null, temperatureCelsius);
    } else {
      callback(new Error('Cached status not available'));
    }
  }

  private handleThresholdTemperatureGet(callback: CharacteristicGetCallback): void {
    this.platform.log.debug('Triggered GET ThresholdTemperature');
    if (this.cachedStatus) {
      const temperatureCelsius = this.fahrenheitToCelsius(this.cachedStatus.target_temp);
      this.platform.log.debug(`Threshold temperature: ${temperatureCelsius}°C`);
      callback(null, temperatureCelsius);
    } else {
      callback(new Error('Cached status not available'));
    }
  }

  private async handleThresholdTemperatureSet(
    value: CharacteristicValue,
    callback: CharacteristicSetCallback,
  ): Promise<void> {
    this.platform.log.debug('Triggered SET ThresholdTemperature:', value);
    try {
      const temperatureFahrenheit = this.celsiusToFahrenheit(value as number);
      await this.deviceAPI.setAirConditionerState('target_temp', temperatureFahrenheit.toString());
      this.updateCachedStatus();
      callback(null);
    } catch (error) {
      this.platform.log.error('Error setting threshold temperature:', error);
      callback(error as Error);
    }
  }

  private handleRotationSpeedGet(callback: CharacteristicGetCallback): void {
    this.platform.log.debug('Triggered GET RotationSpeed');
    if (this.cachedStatus) {
      const fanSpeed = this.mapFanModeToRotationSpeed(this.cachedStatus.fan_mode);
      this.platform.log.debug(`Fan speed: ${fanSpeed}`);
      callback(null, fanSpeed);
    } else {
      callback(new Error('Cached status not available'));
    }
  }

  private async handleRotationSpeedSet(
    value: CharacteristicValue,
    callback: CharacteristicSetCallback,
  ): Promise<void> {
    this.platform.log.debug('Triggered SET RotationSpeed:', value);
    try {
      const fanMode = this.mapRotationSpeedToFanMode(value as number);
      await this.deviceAPI.setFanSpeed(fanMode);
      this.updateCachedStatus();
      callback(null);
    } catch (error) {
      this.platform.log.error('Error setting fan speed:', error);
      callback(error as Error);
    }
  }

  private handleSwingModeGet(callback: CharacteristicGetCallback): void {
    this.platform.log.debug('Triggered GET SwingMode');
    if (this.cachedStatus) {
      callback(null, this.cachedStatus.swing_mode === 'Off' ? 0 : 1);
    } else {
      callback(new Error('Cached status not available'));
    }
  }

  private async handleSwingModeSet(
    value: CharacteristicValue,
    callback: CharacteristicSetCallback,
  ): Promise<void> {
    this.platform.log.debug('Triggered SET SwingMode:', value);
    try {
      const mode = value ? 'Both' : 'Off';
      await this.deviceAPI.setSwingMode(mode);
      this.updateCachedStatus();
      callback(null);
    } catch (error) {
      this.platform.log.error('Error setting swing mode:', error);
      callback(error as Error);
    }
  }

  private handleTurboGet(callback: CharacteristicGetCallback): void {
    this.platform.log.debug('Triggered GET Turbo');
    if (this.cachedStatus && typeof this.cachedStatus.opt_super !== 'undefined') {
      callback(null, this.cachedStatus.opt_super === 'on');
    } else {
      callback(null, false); // Default: off
    }
  }

  private async handleTurboSet(
    value: CharacteristicValue,
    callback: CharacteristicSetCallback,
  ): Promise<void> {
    this.platform.log.debug('Triggered SET Turbo:', value);
    try {
      await this.deviceAPI.setTurboState(value ? 'on' : 'off');
      this.updateCachedStatus();
      callback(null);
    } catch (error) {
      this.platform.log.error('Error setting Turbo state:', error);
      callback(error as Error);
    }
  }

  private handleTemperatureSensorCurrentTemperatureGet(callback: CharacteristicGetCallback): void {
    this.platform.log.debug('Triggered GET TemperatureSensor.CurrentTemperature');
    if (this.cachedStatus) {
      const temperatureCelsius = this.fahrenheitToCelsius(this.cachedStatus.current_temp);
      this.platform.log.debug(`[TemperatureSensor] Current temperature: ${temperatureCelsius}°C`);
      callback(null, temperatureCelsius);
    } else {
      callback(new Error('Cached status not available'));
    }
  }

  private mapOperationModeToCurrentHeaterCoolerState(mode: string): number {
    const { CurrentHeaterCoolerState } = this.platform.Characteristic;
    switch (mode) {
    case 'cool':
      return CurrentHeaterCoolerState.COOLING;
    case 'heat':
      return CurrentHeaterCoolerState.HEATING;
    default:
      return CurrentHeaterCoolerState.IDLE;
    }
  }

  private mapOperationModeToTargetHeaterCoolerState(mode: string): number {
    const { TargetHeaterCoolerState } = this.platform.Characteristic;
    switch (mode) {
    case 'cool':
      return TargetHeaterCoolerState.COOL;
    case 'heat':
      return TargetHeaterCoolerState.HEAT;
    default:
      return TargetHeaterCoolerState.AUTO;
    }
  }

  private mapTargetHeaterCoolerStateToOperationMode(state: number): string {
    const { TargetHeaterCoolerState } = this.platform.Characteristic;
    switch (state) {
    case TargetHeaterCoolerState.COOL:
      return 'cool';
    case TargetHeaterCoolerState.HEAT:
      return 'heat';
    default:
      return 'auto';
    }
  }

  private fahrenheitToCelsius(fahrenheit: number): number {
    return ((fahrenheit - 32) * 5) / 9;
  }

  private celsiusToFahrenheit(celsius: number): number {
    return (celsius * 9) / 5 + 32;
  }

  private mapFanModeToRotationSpeed(fanMode: string): number {
    const fanSpeedMap: { [key: string]: number } = {
      Auto: 50,
      Low: 25,
      Middle: 50,
      High: 75,
    };
    return fanSpeedMap[fanMode] || 50;
  }

  private mapRotationSpeedToFanMode(speed: number): string {
    if (speed <= 25) {
      return 'Low';
    } else if (speed <= 50) {
      return 'Middle';
    } else if (speed <= 75) {
      return 'High';
    } else {
      return 'Auto';
    }
  }
}