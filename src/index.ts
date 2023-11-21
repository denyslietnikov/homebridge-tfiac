// index.ts
import { API } from 'homebridge';
import { AirConditionerAccessory } from './platformAccessory';

export = (api: API) => {
  api.registerAccessory('AirConditionerAccessory', 'AirConditioner', AirConditionerAccessory);

};
