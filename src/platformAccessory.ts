// platformAccessory.ts
import { AccessoryPlugin, AccessoryConfig, API, Logging, Service } from 'homebridge';
import AirConditionerAPI from './AirConditionerAPI';

export class AirConditionerAccessory implements AccessoryPlugin {
  private readonly log: Logging;
  private readonly api: API;
  private readonly name: string;
  private readonly deviceAPI: AirConditionerAPI;
  private readonly service: Service;

  services: Service[]
  private swing = 3;

  constructor(log: Logging, config: AccessoryConfig, api: API) {
    this.log = log;
    this.name = config.name;
    this.api = api;
    this.services = [];
    let ip = '0.0.0.0';
    if (('ip' in config) && ('mac' in config)) {
      ip = config['ip'] as string;
    } else {
      log.error('ip or mac is not provided');
    }
  
    this.deviceAPI = new AirConditionerAPI(ip);

    this.service = new this.api.hap.Service.Switch(this.name);

    // TODO: Add basic characteristics and their handlers
    // Example:
    // this.service.getCharacteristic(this.api.hap.Characteristic.On)
    //   .on('get', this.handleOnGet.bind(this))
    //   .on('set', this.handleOnSet.bind(this));
  }

  // TODO: Add characteristic handlers
  // Example:
  // private async handleOnGet(callback): Promise<void> {
  //   this.log.debug('Triggered GET On');
  //   const isOn = await this.deviceAPI.getOnState();
  //   callback(null, isOn);
  // }

  // private async handleOnSet(value, callback): Promise<void> {
  //   this.log.debug('Triggered SET On:', value);
  //   if (value) {
  //     await this.deviceAPI.turnOn();
  //   } else {
  //     await this.deviceAPI.turnOff();
  //   }
  //   callback(null);
  // }

  getServices(): Service[] {
    return [this.service];
  }
}
