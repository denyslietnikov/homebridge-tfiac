/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  AccessoryPlugin,
  AccessoryConfig,
  API,
  Logging,
  Service,
  CharacteristicValue,
  CharacteristicSetCallback,
  CharacteristicGetCallback,
} from 'homebridge';
import AirConditionerAPI from './AirConditionerAPI';

export class AirConditionerAccessory implements AccessoryPlugin {
  private readonly log: Logging;
  private readonly api: API;
  private readonly name: string;
  private readonly deviceAPI: AirConditionerAPI;
  private readonly service: Service;

  constructor(log: Logging, config: AccessoryConfig, api: API) {
    this.log = log;
    this.name = config.name;
    this.api = api;

    // Extracting 'ip' from config
    let ip = '0.0.0.0';
    if ('ip' in config) {
      ip = config['ip'] as string;
    } else {
      log.error('ip is not provided');
    }

    // Creating an instance of AirConditionerAPI
    this.deviceAPI = new AirConditionerAPI(ip);

    // Creating a HeaterCooler service
    this.service = new this.api.hap.Service.HeaterCooler(this.name);

    // Adding characteristic handlers
    this.service.getCharacteristic(this.api.hap.Characteristic.Active)
      .on('get', this.handleActiveGet.bind(this))
      .on('set', this.handleActiveSet.bind(this));

    this.service.getCharacteristic(this.api.hap.Characteristic.CurrentHeaterCoolerState)
      .on('get', this.handleCurrentHeaterCoolerStateGet.bind(this));

    this.service.getCharacteristic(this.api.hap.Characteristic.TargetHeaterCoolerState)
      .on('get', this.handleTargetHeaterCoolerStateGet.bind(this))
      .on('set', this.handleTargetHeaterCoolerStateSet.bind(this));

    this.service.getCharacteristic(this.api.hap.Characteristic.CurrentTemperature)
      .on('get', this.handleCurrentTemperatureGet.bind(this));
      
    this.service.getCharacteristic(this.api.hap.Characteristic.CoolingThresholdTemperature)
      .on('get', this.handleThresholdTemperatureGet.bind(this))
      .on('set', this.handleThresholdTemperatureSet.bind(this));

    this.service.getCharacteristic(this.api.hap.Characteristic.HeatingThresholdTemperature)
      .on('get', this.handleThresholdTemperatureGet.bind(this))
      .on('set', this.handleThresholdTemperatureSet.bind(this));

    this.service.getCharacteristic(this.api.hap.Characteristic.RotationSpeed)
      .on('get', this.handleRotationSpeedGet.bind(this))
      .on('set', this.handleRotationSpeedSet.bind(this));

    this.service.getCharacteristic(this.api.hap.Characteristic.SwingMode)
      .on('get', this.handleSwingModeGet.bind(this))
      .on('set', this.handleSwingModeSet.bind(this));
  }

  private async handleActiveGet(callback: CharacteristicGetCallback): Promise<void> {
    this.log.debug('Triggered GET Active');
    try {
      const status = await this.deviceAPI.updateState();
      callback(null, status.is_on === 'on' ? this.api.hap.Characteristic.Active.ACTIVE : this.api.hap.Characteristic.Active.INACTIVE);
    } catch (error) {
      this.log.error('Error getting Active state:', error);
      callback(error as Error);
    }
  }

  private async handleActiveSet(value: CharacteristicValue, callback: CharacteristicSetCallback): Promise<void> {
    this.log.debug('Triggered SET Active:', value);
    try {
      if (value === this.api.hap.Characteristic.Active.ACTIVE) {
        await this.deviceAPI.turnOn();
      } else {
        await this.deviceAPI.turnOff();
      }
      callback(null);
    } catch (error) {
      this.log.error('Error setting Active state:', error);
      callback(error as Error);
    }
  }

  private async handleCurrentHeaterCoolerStateGet(callback: CharacteristicGetCallback): Promise<void> {
    this.log.debug('Triggered GET CurrentHeaterCoolerState');
    try {
      const status = await this.deviceAPI.updateState();
      const state = this.mapOperationModeToCurrentHeaterCoolerState(status.operation_mode);
      callback(null, state);
    } catch (error) {
      this.log.error('Error getting CurrentHeaterCoolerState:', error);
      callback(error as Error);
    }
  }

  private async handleTargetHeaterCoolerStateGet(callback: CharacteristicGetCallback): Promise<void> {
    this.log.debug('Triggered GET TargetHeaterCoolerState');
    try {
      const status = await this.deviceAPI.updateState();
      const state = this.mapOperationModeToTargetHeaterCoolerState(status.operation_mode);
      callback(null, state);
    } catch (error) {
      this.log.error('Error getting TargetHeaterCoolerState:', error);
      callback(error as Error);
    }
  }

  private async handleTargetHeaterCoolerStateSet(value: CharacteristicValue, callback: CharacteristicSetCallback): Promise<void> {
    this.log.debug('Triggered SET TargetHeaterCoolerState:', value);
    try {
      const mode = this.mapTargetHeaterCoolerStateToOperationMode(value as number);
      await this.deviceAPI.setAirConditionerState('operation_mode', mode);
      callback(null);
    } catch (error) {
      this.log.error('Error setting TargetHeaterCoolerState:', error);
      callback(error as Error);
    }
  }

  private async handleCurrentTemperatureGet(callback: CharacteristicGetCallback): Promise<void> {
    this.log.debug('Triggered GET CurrentTemperature');
    try {
      const status = await this.deviceAPI.updateState();
      const temperatureCelsius = this.fahrenheitToCelsius(status.current_temp);
      this.log.debug(`Current temperature received: ${temperatureCelsius}°C`);
      callback(null, temperatureCelsius);
    } catch (error) {
      this.log.error('Error getting current temperature:', error);
      callback(error as Error);
    }
  }

  private async handleThresholdTemperatureGet(callback: CharacteristicGetCallback): Promise<void> {
    this.log.debug('Triggered GET ThresholdTemperature');
    try {
      const status = await this.deviceAPI.updateState();
      const temperatureCelsius = this.fahrenheitToCelsius(status.target_temp);
      this.log.debug(`Threshold temperature received: ${temperatureCelsius}°C`);
      callback(null, temperatureCelsius);
    } catch (error) {
      this.log.error('Error getting threshold temperature:', error);
      callback(error as Error);
    }
  }

  private async handleThresholdTemperatureSet(value: CharacteristicValue, callback: CharacteristicSetCallback): Promise<void> {
    this.log.debug('Triggered SET ThresholdTemperature:', value);
    try {
      const temperatureFahrenheit = this.celsiusToFahrenheit(value as number);
      await this.deviceAPI.setAirConditionerState('target_temp', temperatureFahrenheit.toString());
      callback(null);
    } catch (error) {
      this.log.error('Error setting threshold temperature:', error);
      callback(error as Error);
    }
  }

  private async handleRotationSpeedGet(callback: CharacteristicGetCallback): Promise<void> {
    this.log.debug('Triggered GET RotationSpeed');
    try {
      const status = await this.deviceAPI.updateState();
      const fanSpeed = this.mapFanModeToRotationSpeed(status.fan_mode);
      this.log.debug(`Fan speed received: ${fanSpeed}`);
      callback(null, fanSpeed);
    } catch (error) {
      this.log.error('Error getting fan speed:', error);
      callback(error as Error);
    }
  }

  private async handleRotationSpeedSet(value: CharacteristicValue, callback: CharacteristicSetCallback): Promise<void> {
    this.log.debug('Triggered SET RotationSpeed:', value);
    try {
      const fanMode = this.mapRotationSpeedToFanMode(value as number);
      await this.deviceAPI.setFanSpeed(fanMode);
      callback(null);
    } catch (error) {
      this.log.error('Error setting fan speed:', error);
      callback(error as Error);
    }
  }

  private async handleSwingModeGet(callback: CharacteristicGetCallback): Promise<void> {
    this.log.debug('Triggered GET SwingMode');
    try {
      const status = await this.deviceAPI.updateState();
      callback(null, status.swing_mode === 'Off' ? 0 : 1);
    } catch (error) {
      this.log.error('Error getting swing mode:', error);
      callback(error as Error);
    }
  }

  private async handleSwingModeSet(value: CharacteristicValue, callback: CharacteristicSetCallback): Promise<void> {
    this.log.debug('Triggered SET SwingMode:', value);
    try {
      const mode = value ? 'Both' : 'Off';
      await this.deviceAPI.setSwingMode(mode);
      callback(null);
    } catch (error) {
      this.log.error('Error setting swing mode:', error);
      callback(error as Error);
    }
  }

  private mapOperationModeToCurrentHeaterCoolerState(mode: string): number {
    const { Characteristic } = this.api.hap;
    switch (mode) {
      case 'cool':
        return Characteristic.CurrentHeaterCoolerState.COOLING;
      case 'heat':
        return Characteristic.CurrentHeaterCoolerState.HEATING;
      default:
        return Characteristic.CurrentHeaterCoolerState.IDLE;
    }
  }

  private mapOperationModeToTargetHeaterCoolerState(mode: string): number {
    const { Characteristic } = this.api.hap;
    switch (mode) {
      case 'cool':
        return Characteristic.TargetHeaterCoolerState.COOL;
      case 'heat':
        return Characteristic.TargetHeaterCoolerState.HEAT;
      default:
        return Characteristic.TargetHeaterCoolerState.AUTO;
    }
  }

  private mapTargetHeaterCoolerStateToOperationMode(state: number): string {
    const { Characteristic } = this.api.hap;
    switch (state) {
      case Characteristic.TargetHeaterCoolerState.COOL:
        return 'cool';
      case Characteristic.TargetHeaterCoolerState.HEAT:
        return 'heat';
      default:
        return 'auto';
    }
  }

  private fahrenheitToCelsius(fahrenheit: number): number {
    return (fahrenheit - 32) * 5 / 9;
  }

  private celsiusToFahrenheit(celsius: number): number {
    return (celsius * 9 / 5) + 32;
  }

  private mapFanModeToRotationSpeed(fanMode: string): number {
    const fanSpeedMap: { [key: string]: number } = {
      'Auto': 50,
      'Low': 25,
      'Middle': 50,
      'High': 75,
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

  getServices(): Service[] {
    return [this.service];
  }
}