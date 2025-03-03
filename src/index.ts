// index.ts

import { API } from 'homebridge';
import { PLATFORM_NAME } from './settings';
import { TfiacPlatform } from './platform';

export default (api: API) => {
  api.registerPlatform(PLATFORM_NAME, TfiacPlatform);
};