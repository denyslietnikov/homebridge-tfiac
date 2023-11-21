// platformAccessory.ts
import { AccessoryPlugin, AccessoryConfig, API, Logging, Service } from 'homebridge';
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

  getServices(): Service[] {
    return [this.service];
  }
}
