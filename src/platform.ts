// platform.ts

import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  Service,
  Characteristic,
} from 'homebridge';
import * as dgram from 'dgram';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as xml2js from 'xml2js';
import { PLATFORM_NAME, PLUGIN_NAME, TfiacPlatformConfig, TfiacDeviceConfig } from './settings.js';
import { TfiacPlatformAccessory } from './platformAccessory.js';
import { DisplaySwitchAccessory } from './DisplaySwitchAccessory.js';
import { SleepSwitchAccessory } from './SleepSwitchAccessory.js';
import { FanSpeedAccessory } from './FanSpeedAccessory.js';
import { DrySwitchAccessory } from './DrySwitchAccessory.js';
import { FanOnlySwitchAccessory } from './FanOnlySwitchAccessory.js';
import { StandaloneFanAccessory } from './StandaloneFanAccessory.js';
import { HorizontalSwingSwitchAccessory } from './HorizontalSwingSwitchAccessory.js';
import { TurboSwitchAccessory } from './TurboSwitchAccessory.js';
import { EcoSwitchAccessory } from './EcoSwitchAccessory.js';
import { BeepSwitchAccessory } from './BeepSwitchAccessory.js';
import { CacheManager } from './CacheManager.js';

interface OptionalAccessoryConfig<T> {
  name: string;
  displayName: string;
  enabledByDefault: boolean;
  accessoryClass: new (platform: TfiacPlatform, accessory: PlatformAccessory, cacheManager: CacheManager) => T;
  condition?: (config: TfiacDeviceConfig) => boolean;
  accessoryMap?: Map<string, T>;
}

export class TfiacPlatform implements DynamicPlatformPlugin {
  public Service: typeof Service;
  public Characteristic: typeof Characteristic;
  public readonly api: API;

  private readonly accessories: PlatformAccessory[] = [];
  private readonly optionalAccessoryConfigs: OptionalAccessoryConfig<unknown>[];
  private readonly discoveredAccessories: Map<string, TfiacPlatformAccessory>;
  private _debugEnabled: boolean = false; // Declare and initialize _debugEnabled
  private readonly PLUGIN_VERSION = '1.27.0'; // Current plugin version
  private readonly CACHE_CLEANUP_VERSION = '1.26.0'; // Version that requires cache cleanup

  constructor(
    public readonly log: Logger,
    public readonly config: TfiacPlatformConfig,
    apiParam: unknown,
  ) {
    this.api = apiParam as API;
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
    this.discoveredAccessories = new Map<string, TfiacPlatformAccessory>();

    // Initialize _debugEnabled based on global config first
    this._debugEnabled = !!this.config.debug;

    // Then, if global debug is not set, check device-specific debug flags
    if (!this._debugEnabled && Array.isArray(this.config.devices)) {
      this._debugEnabled = this.config.devices.some(device => device.debug === true);
    }

    const originalDebug = this.log.debug.bind(this.log);
    this.log.debug = (...args: [message: string, ...optionalParams: unknown[]]) => {
      if (this._debugEnabled) { // Use the class property
        originalDebug(...args);
      }
    };

    this.log.debug('TfiacPlatform constructor called');

    this.optionalAccessoryConfigs = [
      { name: 'Display', displayName: 'Display Light', enabledByDefault: true, accessoryClass: DisplaySwitchAccessory, accessoryMap: new Map() },
      { name: 'Sleep', displayName: 'Sleep Mode', enabledByDefault: true, accessoryClass: SleepSwitchAccessory, accessoryMap: new Map() },
      { name: 'FanSpeed', displayName: 'Fan Speed Control', enabledByDefault: true, accessoryClass: FanSpeedAccessory, accessoryMap: new Map() },
      { name: 'Dry', displayName: 'Dry Mode', enabledByDefault: true, accessoryClass: DrySwitchAccessory, accessoryMap: new Map() },
      { name: 'FanOnly', displayName: 'Fan Only Switch', enabledByDefault: true, accessoryClass: FanOnlySwitchAccessory, accessoryMap: new Map() },
      { name: 'Turbo', displayName: 'Turbo Mode', enabledByDefault: true, accessoryClass: TurboSwitchAccessory, accessoryMap: new Map() },
      { name: 'Eco', displayName: 'Eco Mode', enabledByDefault: true, accessoryClass: EcoSwitchAccessory, accessoryMap: new Map() },
      { name: 'StandaloneFan', displayName: 'Fan Only Mode', enabledByDefault: false, accessoryClass: StandaloneFanAccessory, accessoryMap: new Map() },
      {
        name: 'HorizontalSwing',
        displayName: 'Horizontal Swing',
        enabledByDefault: false,
        accessoryClass: HorizontalSwingSwitchAccessory,
        accessoryMap: new Map(),
      },
      { name: 'Beep', displayName: 'Beep Sound', enabledByDefault: false, accessoryClass: BeepSwitchAccessory, accessoryMap: new Map() },
    ];

    this.api.on('didFinishLaunching', async () => {
      this.log.debug('didFinishLaunching callback');
      await this.checkVersionAndCleanupCache();
      await this.discoverDevices();
    });
  }

  /**
   * Check plugin version and perform cache cleanup if needed
   */
  async checkVersionAndCleanupCache(): Promise<void> {
    try {
      // Get stored version from HomeKit cache
      const storedVersion = this.api.user.storagePath();
      const versionFilePath = path.join(storedVersion, 'homebridge-tfiac-version.json');
      
      let lastVersion: string | null = null;
      
      try {
        const versionData = await fs.readFile(versionFilePath, 'utf8');
        const parsedData = JSON.parse(versionData);
        lastVersion = parsedData.version;
        this.log.debug(`Found previous plugin version: ${lastVersion}`);
      } catch (error) {
        // Version file doesn't exist or is corrupted - treat as first install
        this.log.info('No previous version found - treating as fresh installation');
      }

      // Check if we need to perform cache cleanup
      const needsCleanup = !lastVersion || this.compareVersions(lastVersion, this.CACHE_CLEANUP_VERSION) < 0;
      
      if (needsCleanup) {
        this.log.warn(`Plugin updated from ${lastVersion || 'unknown'} to ${this.PLUGIN_VERSION} - performing cache cleanup`);
        this.log.warn('This will remove all cached accessories to ensure compatibility with the new version');
        this.log.warn('All accessories will be automatically recreated with the new configuration options');
        await this.performCacheCleanup();
      } else {
        this.log.debug(`Plugin version ${this.PLUGIN_VERSION} - no cache cleanup needed (last version: ${lastVersion})`);
      }

      // Save current version
      await fs.writeFile(versionFilePath, JSON.stringify({ 
        version: this.PLUGIN_VERSION,
        lastCleanup: new Date().toISOString(),
        cleanupReason: needsCleanup ? 'version_upgrade' : 'no_cleanup_needed',
      }), 'utf8');

      this.log.debug(`Version tracking updated: ${this.PLUGIN_VERSION}`);

    } catch (error) {
      this.log.error('Error during version check and cache cleanup:', error);
    }
  }

  /**
   * Perform cache cleanup by removing all cached accessories
   */
  private async performCacheCleanup(): Promise<void> {
    this.log.warn('Performing cache cleanup - removing all cached accessories to ensure clean state');
    
    // Remove all cached accessories to force recreation
    if (this.accessories.length > 0) {
      this.log.info(`Removing ${this.accessories.length} cached accessories for clean update`);
      
      // First, perform thorough cleanup of each accessory
      this.accessories.forEach(acc => {
        this.log.debug(`Cleaning up accessory: ${acc.displayName} (${acc.UUID})`);
        
        // Cleanup optional accessories first
        this.cleanupOptionalAccessories(acc.UUID);
        
        // Remove all services from the accessory to ensure clean state
        const servicesToRemove = acc.services.slice(); // Create a copy to avoid modification during iteration
        servicesToRemove.forEach(service => {
          // Don't remove the AccessoryInformation service as it's required
          if (service.UUID !== this.Service.AccessoryInformation.UUID) {
            try {
              acc.removeService(service);
              this.log.debug(`Removed service ${service.displayName || service.UUID} from ${acc.displayName}`);
            } catch (error) {
              this.log.debug(`Error removing service ${service.displayName || service.UUID}:`, error);
            }
          }
        });
      });

      // Unregister all accessories from HomeKit
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, this.accessories);
      
      // Clear local array
      this.accessories.length = 0;
      
      // Clear the discovered accessories map
      this.discoveredAccessories.clear();
      
      // Clear all optional accessory maps
      this.optionalAccessoryConfigs.forEach(config => {
        config.accessoryMap?.clear();
      });
      
      this.log.info('Cache cleanup completed - all accessories and services removed, will be recreated during discovery');
    } else {
      this.log.debug('No cached accessories found to cleanup');
    }
  }

  /**
   * Compare two semantic version strings
   * Returns: -1 if version1 < version2, 0 if equal, 1 if version1 > version2
   */
  private compareVersions(version1: string, version2: string): number {
    const v1parts = version1.split('.').map(Number);
    const v2parts = version2.split('.').map(Number);
    
    for (let i = 0; i < Math.max(v1parts.length, v2parts.length); i++) {
      const v1part = v1parts[i] || 0;
      const v2part = v2parts[i] || 0;
      
      if (v1part < v2part) {
        return -1;
      }
      if (v1part > v2part) {
        return 1;
      }
    }
    
    return 0;
  }

  async discoverDevices() {
    const configuredDevices = (this.config.devices || []) as TfiacDeviceConfig[];
    const discoveredDevicesMap = new Map<string, TfiacDeviceConfig>();
    const enableDiscovery = this.config.enableDiscovery !== false;

    const processedIPs = new Set<string>();

    for (const deviceConfig of configuredDevices) {
      if (!deviceConfig.ip) {
        this.log.error('Missing required IP address for configured device:', deviceConfig.name);
        continue;
      }

      if (processedIPs.has(deviceConfig.ip)) {
        this.log.error('Failed to initialize device:', new Error(`Duplicate IP address detected: ${deviceConfig.ip}`));
        continue;
      }

      processedIPs.add(deviceConfig.ip);

      discoveredDevicesMap.set(deviceConfig.ip, { ...deviceConfig });
      this.log.debug(`Found configured device: ${deviceConfig.name} (${deviceConfig.ip})`);
    }

    if (enableDiscovery) {
      this.log.info('Starting network discovery for TFIAC devices...');
      try {
        const networkDiscoveredIPs = await this.discoverDevicesNetwork(5000);
        this.log.info(`Network discovery finished. Found ${networkDiscoveredIPs.size} potential devices.`);
        for (const ip of networkDiscoveredIPs) {
          if (!discoveredDevicesMap.has(ip)) {
            discoveredDevicesMap.set(ip, { ip: ip, name: `TFIAC ${ip}` });
            this.log.debug(`Discovered new device via network: ${ip}`);
          } else {
            this.log.debug(`Network discovered device ${ip} is already configured.`);
          }
        }
      } catch (error) {
        this.log.error('Network discovery failed:', error);
      }
    } else {
      this.log.info('Network discovery is disabled in the configuration.');
    }

    const allDevices = Array.from(discoveredDevicesMap.values());

    if (allDevices.length === 0) {
      this.log.info('No configured or discovered devices found.');
    }

    const currentAccessoryUUIDs = new Set<string>();

    for (const device of allDevices) {
      const uuid = this.api.hap.uuid.generate(device.ip + (device.name || ''));
      currentAccessoryUUIDs.add(uuid);

      const existingAccessory = this.accessories.find((acc) => acc.UUID === uuid);

      const deviceConfigForAccessory: TfiacDeviceConfig = {
        ...(device as TfiacDeviceConfig),
        name: device.name || `TFIAC ${device.ip}`,
      };

      const cacheManager = CacheManager.getInstance(deviceConfigForAccessory, this.log);

      if (existingAccessory) {
        const prevConfig = existingAccessory.context.deviceConfig as TfiacDeviceConfig | undefined;
        const configChanged = !prevConfig ||
          prevConfig.name !== deviceConfigForAccessory.name ||
          prevConfig.ip !== deviceConfigForAccessory.ip ||
          prevConfig.port !== deviceConfigForAccessory.port;

        this.removeDisabledServices(existingAccessory, deviceConfigForAccessory);

        existingAccessory.context.deviceConfig = deviceConfigForAccessory;

        if (configChanged) {
          this.log.info(`Updating existing accessory: ${deviceConfigForAccessory.name} (${device.ip})`);
          existingAccessory.context.deviceConfig = deviceConfigForAccessory;
          existingAccessory.displayName = deviceConfigForAccessory.name;
          existingAccessory.category = this.api.hap.Categories.AIR_CONDITIONER;
          this.api.updatePlatformAccessories([existingAccessory]);
        }
        try {
          if (!this.discoveredAccessories.has(uuid)) {
            const tfiacAccessory = new TfiacPlatformAccessory(this, existingAccessory);
            this.discoveredAccessories.set(uuid, tfiacAccessory);
            this.setupOptionalAccessories(existingAccessory, deviceConfigForAccessory, uuid, cacheManager);
          }
        } catch (error) {
          this.log.error('Failed to initialize device:', error);
        }
      } else {
        this.log.info(`Adding new accessory: ${deviceConfigForAccessory.name} (${device.ip})`);
        const accessory = new this.api.platformAccessory(deviceConfigForAccessory.name, uuid);
        accessory.category = this.api.hap.Categories.AIR_CONDITIONER;
        accessory.context.deviceConfig = deviceConfigForAccessory;
        try {
          const tfiacAccessory = new TfiacPlatformAccessory(this, accessory);
          this.discoveredAccessories.set(uuid, tfiacAccessory);
          this.setupOptionalAccessories(accessory, deviceConfigForAccessory, uuid, cacheManager);
          this.removeDisabledServices(accessory, deviceConfigForAccessory);
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          this.accessories.push(accessory);
        } catch (error) {
          this.log.error('Failed to initialize device:', error);
        }
      }
    }

    const accessoriesToRemove = this.accessories.filter(acc => !currentAccessoryUUIDs.has(acc.UUID));
    if (accessoriesToRemove.length > 0) {
      this.log.info(`Removing ${accessoriesToRemove.length} stale accessories.`);
      accessoriesToRemove.forEach(acc => {
        this.cleanupOptionalAccessories(acc.UUID);
      });
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, accessoriesToRemove);
      accessoriesToRemove.forEach(acc => {
        const idx = this.accessories.findIndex(a => a.UUID === acc.UUID);
        if (idx > -1) {
          this.accessories.splice(idx, 1);
        }
      });
    }
  }

  private discoverDevicesNetwork(timeoutMs: number): Promise<Set<string>> {
    return new Promise((resolve) => {
      const discoveredIPs = new Set<string>();
      const discoveryMessage = Buffer.from(
        `<msg msgid="SyncStatusReq" type="Control" seq="${Date.now() % 10000000}">` +
        '<SyncStatusReq></SyncStatusReq></msg>',
      );
      const broadcastAddress = '255.255.255.255';
      const discoveryPort = 7777;

      const socket = dgram.createSocket('udp4');
      if (typeof socket.unref === 'function') {
        socket.unref();
      }

      let discoveryTimeout: NodeJS.Timeout | null = null;
      let finished = false;

      const cleanupAndResolve = () => {
        if (finished) {
          return;
        }
        finished = true;
        if (discoveryTimeout) {
          clearTimeout(discoveryTimeout);
          discoveryTimeout = null;
        }
        try {
          socket.close(() => {
            this.log.debug('Discovery socket closed.');
            resolve(discoveredIPs);
          });
        } catch (e) {
          this.log.debug('Error closing discovery socket:', e);
          resolve(discoveredIPs);
        }
      };

      socket.on('error', (err) => {
        this.log.error('Discovery socket error:', err);
        cleanupAndResolve();
      });

      socket.on('message', async (msg, rinfo) => {
        this.log.debug(`Received discovery response from ${rinfo.address}:${rinfo.port}`);
        try {
          const xmlString = msg.toString();
          if (xmlString.includes('<statusUpdateMsg>')) {
            const xmlObject = await xml2js.parseStringPromise(xmlString);
            if (xmlObject?.msg?.statusUpdateMsg?.[0]?.IndoorTemp?.[0]) {
              if (!discoveredIPs.has(rinfo.address)) {
                this.log.info(`Discovered TFIAC device at ${rinfo.address}`);
                discoveredIPs.add(rinfo.address);
              }
            } else {
              this.log.debug(`Ignoring non-status response from ${rinfo.address}`, xmlString);
            }
          } else {
            this.log.debug(`Ignoring non-XML/non-status response from ${rinfo.address}`, xmlString);
          }
        } catch (parseError) {
          this.log.debug(`Error parsing response from ${rinfo.address}:`, parseError);
        }
      });

      socket.on('listening', () => {
        try {
          socket.setBroadcast(true);
          this.log.debug(`Discovery socket listening on ${socket.address().address}:${socket.address().port}`);
          socket.send(discoveryMessage, discoveryPort, broadcastAddress, (err) => {
            if (err) {
              this.log.error('Error sending discovery broadcast:', err);
            } else {
              this.log.debug('Discovery broadcast message sent.');
            }
          });
        } catch (err) {
          this.log.error('Error setting up broadcast:', err);
          cleanupAndResolve();
        }
      });

      try {
        socket.bind();
        discoveryTimeout = setTimeout(() => {
          this.log.debug('Discovery timeout reached.');
          cleanupAndResolve();
        }, timeoutMs);
        if (discoveryTimeout.unref) {
          discoveryTimeout.unref();
        }
      } catch (err) {
        this.log.error('Error setting up discovery socket:', err);
        cleanupAndResolve();
      }
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info(`Loading accessory from cache: ${accessory.displayName}`);
    accessory.category = this.api.hap.Categories.AIR_CONDITIONER;
    this.accessories.push(accessory);
  }

  private removeDisabledServices(accessory: PlatformAccessory, deviceConfig: TfiacDeviceConfig) {
    const servicesToRemove: OptionalAccessoryConfig<unknown>[] = this.optionalAccessoryConfigs.map(config => ({
      name: config.name,
      displayName: config.displayName,
      enabledByDefault: config.enabledByDefault,
      accessoryClass: config.accessoryClass,
    }));

    let serviceRemoved = false;

    // Service subtype mapping for proper cleanup
    const serviceSubtypeMap: Record<string, { serviceUUID: string; subtype: string }> = {
      'Display': { serviceUUID: this.Service.Switch.UUID, subtype: 'display' },
      'Sleep': { serviceUUID: this.Service.Switch.UUID, subtype: 'sleep' },
      'FanSpeed': { serviceUUID: this.Service.Fanv2.UUID, subtype: 'fan_speed' },
      'Dry': { serviceUUID: this.Service.Switch.UUID, subtype: 'dry' },
      'FanOnly': { serviceUUID: this.Service.Switch.UUID, subtype: 'fanonly' },
      'Turbo': { serviceUUID: this.Service.Switch.UUID, subtype: 'turbo' },
      'Eco': { serviceUUID: this.Service.Switch.UUID, subtype: 'eco' },
      'StandaloneFan': { serviceUUID: this.Service.Fan.UUID, subtype: 'standalonefan' },
      'HorizontalSwing': { serviceUUID: this.Service.Switch.UUID, subtype: 'horizontalswing' },
      'Beep': { serviceUUID: this.Service.Switch.UUID, subtype: 'beep' },
    };

    servicesToRemove.forEach(({ name, displayName }) => {
      const configKey = `enable${name}` as keyof TfiacDeviceConfig;
      if (deviceConfig[configKey] === false) {
        const serviceInfo = serviceSubtypeMap[name];
        if (serviceInfo) {
          const service = accessory.getServiceById(serviceInfo.serviceUUID, serviceInfo.subtype);
          if (service) {
            accessory.removeService(service);
            this.log.debug(`[${deviceConfig.name}] Removed service: ${displayName}`);
            serviceRemoved = true;
          }
        } else {
          // Fallback to old method for any unmapped services (shouldn't happen)
          const service = accessory.getService(displayName);
          if (service) {
            accessory.removeService(service);
            this.log.debug(`[${deviceConfig.name}] Removed service: ${displayName}`);
            serviceRemoved = true;
          }
        }
      }
    });

    // Special case for temperature sensors
    const isTemperatureDisabled = deviceConfig.enableTemperature === false;
    const isIFeelDisabled = deviceConfig.enableIFeelSensor === false;

    if (isTemperatureDisabled) {
      if (deviceConfig.debug) {
        this.log.info(`Temperature sensors are disabled for ${deviceConfig.name} - removing any that were cached.`);
      }
      const indoorTempService = accessory.getServiceById(this.Service.TemperatureSensor.UUID, 'indoor_temperature');
      if (indoorTempService) {
        accessory.removeService(indoorTempService);
        this.log.debug(`[${deviceConfig.name}] Removed existing indoor temperature sensor service.`);
        serviceRemoved = true;
      }
      const outdoorTempService = accessory.getServiceById(this.Service.TemperatureSensor.UUID, 'outdoor_temperature');
      if (outdoorTempService) {
        accessory.removeService(outdoorTempService);
        this.log.debug(`[${deviceConfig.name}] Removed existing outdoor temperature sensor service.`);
        serviceRemoved = true;
      }
    }

    if (isIFeelDisabled) {
      if (deviceConfig.debug) {
        this.log.info(`iFeel sensor is disabled for ${deviceConfig.name} - removing any that were cached.`);
      }
      const iFeelService = accessory.getServiceById(this.Service.Switch.UUID, 'ifeel_sensor');
      if (iFeelService) {
        accessory.removeService(iFeelService);
        this.log.debug(`[${deviceConfig.name}] Removed existing iFeel sensor service.`);
        serviceRemoved = true;
      }
    }

    if (serviceRemoved) {
      this.log.info(`Updating accessory ${accessory.displayName} after removing disabled services.`);
      this.api.updatePlatformAccessories([accessory]);
    } else {
      this.log.debug(`No services needed removal for ${accessory.displayName}.`);
    }
  }

  private setupOptionalAccessories(
    accessory: PlatformAccessory,
    deviceConfig: TfiacDeviceConfig,
    uuid: string,
    cacheManager: CacheManager,
  ): void {
    for (const config of this.optionalAccessoryConfigs) {
      const { name, displayName, accessoryClass, enabledByDefault, accessoryMap } = config;
      
      const settingNameLegacy = name.toLowerCase() as keyof TfiacDeviceConfig;
      const settingNameNew = `enable${name}` as keyof TfiacDeviceConfig;
      const settingNameSwitch = `enable${name}Switch` as keyof TfiacDeviceConfig;
      
      let isEnabled = enabledByDefault;
      
      if (deviceConfig[settingNameLegacy] !== undefined) {
        isEnabled = Boolean(deviceConfig[settingNameLegacy]);
      }
      
      if (deviceConfig[settingNameNew] !== undefined) {
        isEnabled = Boolean(deviceConfig[settingNameNew]);
      }
      
      if (deviceConfig[settingNameSwitch] !== undefined) {
        isEnabled = Boolean(deviceConfig[settingNameSwitch]);
      }

      if (isEnabled) {
        const instance = new accessoryClass(this, accessory, cacheManager);
        accessoryMap?.set(uuid, instance);
        this.log.info(`Added ${displayName} for ${deviceConfig.name}`);
      } else {
        if (deviceConfig.debug) {
          this.log.info(`Skipping ${displayName} for ${deviceConfig.name} as it is disabled in config.`);
        }
      }
    }
  }

  private cleanupOptionalAccessories(uuid: string): void {
    const tfiacAcc = this.discoveredAccessories.get(uuid);
    if (tfiacAcc) {
      tfiacAcc.stopPolling();
      this.discoveredAccessories.delete(uuid);
    }

    this.optionalAccessoryConfigs.forEach(config => {
      const instance = config.accessoryMap?.get(uuid);
      if (instance && typeof instance === 'object' && instance !== null && 'stopPolling' in instance) {
        const instanceWithStopPolling = instance as { stopPolling?: () => void };
        if (typeof instanceWithStopPolling.stopPolling === 'function') {
          instanceWithStopPolling.stopPolling();
        }
      }
      config.accessoryMap?.delete(uuid);
    });
  }
}