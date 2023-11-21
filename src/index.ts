import { API } from 'homebridge';

import { AirConditionerAccessory } from './platformAccessory'; 

/**
 * This method registers the platform with Homebridge
 */
export = (api: API) => {
  api.registerAccessory('AirCondionerAccessory', AirConditionerAccessory);
}
