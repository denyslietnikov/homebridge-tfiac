// platformAccessory.ts
import { AccessoryPlugin, AccessoryConfig, API, Logging, Service } from 'homebridge';
import AirConditionerAPI from './AirConditionerAPI';

export class AirConditionerAccessory implements AccessoryPlugin {
  private readonly log: Logging;
  private readonly api: API;
  private readonly name: string;
  private readonly deviceAPI: AirConditionerAPI;
  private readonly service: Service;
  handleTemperatureDisplayUnitsGet: any;
  handleTemperatureDisplayUnitsSet: any;
  handleTargetTemperatureGet: any;
  handleTargetTemperatureSet: any;
  handleTargetHeatingCoolingStateGet: any;
  handleTargetHeatingCoolingStateSet: any;
  handleCurrentHeatingCoolingStateGet: any;

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

    // Creating a Switch service
    this.service = new this.api.hap.Service.Switch(this.name);

    // Adding characteristic handlers
    this.service.getCharacteristic(this.api.hap.Characteristic.On)
      .on('get', this.handleOnGet.bind(this))
      .on('set', this.handleOnSet.bind(this));
  }

  private async handleOnGet(callback): Promise<void> {
    this.log.debug('Triggered GET On');

    // Example: Get the state from the device API
    const isOn = await this.deviceAPI.getOnState();

    callback(null, isOn);
  }

  private async handleOnSet(value, callback): Promise<void> {
    this.log.debug('Triggered SET On:', value);

    // Example: Set the state on the device API
    if (value) {
      await this.deviceAPI.turnOn();
    } else {
      await this.deviceAPI.turnOff();
    }

    callback(null);
  }

  // New methods for controlling the air conditioner
  private async handleTurnOn(callback): Promise<void> {
    this.log.debug('Triggered Turn On');

    // Example: Turn on the air conditioner using the new method
    await this.deviceAPI.turnOn();

    callback(null);
  }

  private async handleTurnOff(callback): Promise<void> {
    this.log.debug('Triggered Turn Off');

    // Example: Turn off the air conditioner using the new method
    await this.deviceAPI.turnOff();

    callback(null);
  }

  getServices(): Service[] {
    // Adding new characteristics to the service
    this.service.getCharacteristic(this.api.hap.Characteristic.On)
      .on('get', this.handleOnGet.bind(this))
      .on('set', this.handleOnSet.bind(this));

    // Adding new characteristics to the service
    this.service.addCharacteristic(this.api.hap.Characteristic.OutletInUse);
    this.service.addCharacteristic(this.api.hap.Characteristic.Name);
    this.service.addCharacteristic(this.api.hap.Characteristic.CurrentTemperature);

    // Adding new characteristic handlers
    this.service.getCharacteristic(this.api.hap.Characteristic.TemperatureDisplayUnits)
      .on('get', this.handleTemperatureDisplayUnitsGet.bind(this))
      .on('set', this.handleTemperatureDisplayUnitsSet.bind(this));

    this.service.getCharacteristic(this.api.hap.Characteristic.TargetTemperature)
      .on('get', this.handleTargetTemperatureGet.bind(this))
      .on('set', this.handleTargetTemperatureSet.bind(this));

    this.service.getCharacteristic(this.api.hap.Characteristic.TargetHeatingCoolingState)
      .on('get', this.handleTargetHeatingCoolingStateGet.bind(this))
      .on('set', this.handleTargetHeatingCoolingStateSet.bind(this));

    this.service.getCharacteristic(this.api.hap.Characteristic.CurrentHeatingCoolingState)
      .on('get', this.handleCurrentHeatingCoolingStateGet.bind(this));

    return [this.service];
  }
}
