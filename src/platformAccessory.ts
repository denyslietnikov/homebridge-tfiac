// platformAccessory.ts
import { AccessoryPlugin, API, Logging, Service } from 'homebridge';
import { YourDeviceAPI } from './yourDeviceAPI';
import { DeviceConfig } from './settings';

export class YourDeviceAccessory implements AccessoryPlugin {
  private readonly log: Logging;
  private readonly api: API;
  private readonly name: string;
  private readonly deviceAPI: YourDeviceAPI;

  private readonly service: Service;

  private readonly config: DeviceConfig;

  constructor(log: Logging, config: DeviceConfig, api: API) {
    this.log = log;
    this.name = config.name;
    this.api = api;
    this.config = config;

    if (!config.ip || !config.port) {
      log.error('IP or port is not provided in the configuration.');
      throw new Error('IP or port is missing.');
    }

    const ip = config.ip as string;
    const port = config.port as number;    

    this.deviceAPI = new YourDeviceAPI(ip, port);

    this.service = new this.api.hap.Service.Switch(this.name);

    this.service.getCharacteristic(this.api.hap.Characteristic.On)
      .on('get', this.handleOnGet.bind(this))
      .on('set', this.handleOnSet.bind(this));
  }

  private async handleOnGet(callback): Promise<void> {
    this.log.debug('Triggered GET On');

    const isOn = await this.deviceAPI.getOnState();
    callback(null, isOn);
  }

  private async handleOnSet(value, callback): Promise<void> {
    this.log.debug('Triggered SET On:', value);

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
