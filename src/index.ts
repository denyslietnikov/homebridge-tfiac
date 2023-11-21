// index.ts
import { API } from 'homebridge';
import { YourDeviceAccessory } from './platformAccessory';

/**
 * This method registers the platform with Homebridge
 */
export = (api: API) => {
  api.registerAccessory('YourDeviceAccessory', 'YourDevice', YourDeviceAccessory);
};
