// index.ts

import { API, PlatformPluginConstructor } from 'homebridge';
import { PLATFORM_NAME, TfiacPlatformConfig } from './settings.js';
import { TfiacPlatform } from './platform.js';

export default (api: API) => {
  api.registerPlatform(
    PLATFORM_NAME,
    TfiacPlatform as PlatformPluginConstructor<TfiacPlatformConfig>,
  );
};