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
import * as xml2js from 'xml2js';
import { PLATFORM_NAME, PLUGIN_NAME, TfiacPlatformConfig, TfiacDeviceConfig } from './settings.js';
import { TfiacPlatformAccessory } from './platformAccessory.js';
import { DisplaySwitchAccessory } from './DisplaySwitchAccessory.js';
import { SleepSwitchAccessory } from './SleepSwitchAccessory.js';
import { FanSpeedAccessory } from './FanSpeedAccessory.js';
import { DrySwitchAccessory } from './DrySwitchAccessory.js';
import { FanOnlySwitchAccessory } from './FanOnlySwitchAccessory.js';
import { StandaloneFanAccessory } from './StandaloneFanAccessory.js';
import { HorizontalSwingSwitchAccessory } from './HorizontalSwingSwitchAccessory.js'; // Add Horizontal Swing accessory import
import { TurboSwitchAccessory } from './TurboSwitchAccessory.js'; // Add Turbo accessory import
import { EcoSwitchAccessory } from './EcoSwitchAccessory.js';
import { BeepSwitchAccessory } from './BeepSwitchAccessory.js';

// Define a structure for discovered devices
interface DiscoveredDevice {
  ip: string;
  name?: string; // Name might not be available via discovery
  port?: number; // Port might be discovered or assumed
}

// Define a type for the service removal configuration
type ServiceRemovalConfig = {
  configFlag: keyof TfiacDeviceConfig;
  serviceName: string;
  logMessage: string;
};

// Define a configuration for optional accessories
interface OptionalAccessoryConfig<T> {
  configFlag: keyof TfiacDeviceConfig;  // Configuration flag name (e.g., 'enableDisplay')
  accessoryClass: new (platform: TfiacPlatform, accessory: PlatformAccessory) => T; // Constructor class
  accessoryMap: Map<string, T>;        // Map to store instances
  displayName: string;                 // Name for logging
  defaultValue?: boolean;              // Default value if not specified (true if undefined)
}

export class TfiacPlatform implements DynamicPlatformPlugin {
  public Service: typeof Service;
  public Characteristic: typeof Characteristic;
  public readonly api: API;

  // Array of discovered accessories
  private readonly accessories: PlatformAccessory[] = [];
  private readonly discoveredAccessories: Map<string, TfiacPlatformAccessory> = new Map();
  private readonly displayAccessories: Map<string, DisplaySwitchAccessory> = new Map();
  private readonly sleepAccessories: Map<string, SleepSwitchAccessory> = new Map();
  private readonly fanSpeedAccessories: Map<string, FanSpeedAccessory> = new Map();
  private readonly dryAccessories: Map<string, DrySwitchAccessory> = new Map(); // Track dry switch accessories
  private readonly fanOnlyAccessories: Map<string, FanOnlySwitchAccessory> = new Map(); // Track Fan Only Mode accessories
  private readonly standaloneFanAccessories: Map<string, StandaloneFanAccessory> = new Map(); // Track Standalone Fan accessories
  private readonly horizontalSwingAccessories: Map<string, HorizontalSwingSwitchAccessory> = new Map(); // Track Horizontal Swing accessories
  private readonly turboAccessories: Map<string, TurboSwitchAccessory> = new Map(); // Track Turbo accessories
  private readonly ecoAccessories: Map<string, EcoSwitchAccessory> = new Map();
  private readonly beepAccessories: Map<string, BeepSwitchAccessory> = new Map();

  // Array of optional accessory configurations
  private optionalAccessoryConfigs: Array<OptionalAccessoryConfig<
    | DisplaySwitchAccessory
    | SleepSwitchAccessory
    | FanSpeedAccessory
    | DrySwitchAccessory
    | FanOnlySwitchAccessory
    | StandaloneFanAccessory
    | HorizontalSwingSwitchAccessory
    | TurboSwitchAccessory
    | EcoSwitchAccessory
    | BeepSwitchAccessory
  >> = [];

  constructor(
    public readonly log: Logger,
    public readonly config: TfiacPlatformConfig,
    apiParam: unknown,
  ) {
    this.api = apiParam as API;
    // Initialize Service and Characteristic after api is assigned
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    this.log.debug('TfiacPlatform constructor called');
    
    // Initialize accessory configs
    this.initializeAccessoryConfigs();

    // Homebridge will fire "didFinishLaunching" when it has loaded all configs
    this.api.on('didFinishLaunching', async () => {
      this.log.debug('didFinishLaunching callback');
      await this.discoverDevices(); // Make discoverDevices async
    });
  }

  /**
   * Initialize all optional accessory configurations
   */
  private initializeAccessoryConfigs(): void {
    this.optionalAccessoryConfigs = [
      {
        configFlag: 'enableDisplay',
        accessoryClass: DisplaySwitchAccessory,
        accessoryMap: this.displayAccessories,
        displayName: 'Display Switch',
        defaultValue: true,
      },
      {
        configFlag: 'enableSleep',
        accessoryClass: SleepSwitchAccessory,
        accessoryMap: this.sleepAccessories,
        displayName: 'Sleep Switch',
        defaultValue: true, // Changed default to true to enable sleep by default
      },
      {
        configFlag: 'enableFanSpeed',
        accessoryClass: FanSpeedAccessory,
        accessoryMap: this.fanSpeedAccessories,
        displayName: 'Fan Speed',
        defaultValue: true,
      },
      {
        configFlag: 'enableDry',
        accessoryClass: DrySwitchAccessory,
        accessoryMap: this.dryAccessories,
        displayName: 'Dry Switch',
        defaultValue: false,
      },
      {
        configFlag: 'enableFanOnly',
        accessoryClass: FanOnlySwitchAccessory,
        accessoryMap: this.fanOnlyAccessories,
        displayName: 'Fan Only Switch',
        defaultValue: false,
      },
      {
        configFlag: 'enableStandaloneFan',
        accessoryClass: StandaloneFanAccessory,
        accessoryMap: this.standaloneFanAccessories,
        displayName: 'Standalone Fan',
        defaultValue: false,
      },
      {
        configFlag: 'enableHorizontalSwing',
        accessoryClass: HorizontalSwingSwitchAccessory,
        accessoryMap: this.horizontalSwingAccessories,
        displayName: 'Horizontal Swing Switch',
        defaultValue: false,
      },
      {
        configFlag: 'enableTurbo',
        accessoryClass: TurboSwitchAccessory,
        accessoryMap: this.turboAccessories,
        displayName: 'Turbo Switch',
        defaultValue: true,
      },
      {
        configFlag: 'enableEco',
        accessoryClass: EcoSwitchAccessory,
        accessoryMap: this.ecoAccessories,
        displayName: 'Eco Switch',
        defaultValue: false,
      },
      {
        configFlag: 'enableBeep',
        accessoryClass: BeepSwitchAccessory,
        accessoryMap: this.beepAccessories,
        displayName: 'Beep Switch',
        defaultValue: false,
      },
    ];
  }

  /**
   * Discover devices from config and optionally via network broadcast.
   */
  async discoverDevices() {
    const configuredDevices = (this.config.devices || []) as TfiacDeviceConfig[];
    const discoveredDevicesMap = new Map<string, DiscoveredDevice>();
    const enableDiscovery = this.config.enableDiscovery !== false; // default true
    
    // Track IPs that have already been processed to detect duplicates
    const processedIPs = new Set<string>();

    // 1. Process configured devices first
    for (const deviceConfig of configuredDevices) {
      if (!deviceConfig.ip) {
        this.log.error('Missing required IP address for configured device:', deviceConfig.name);
        continue;
      }
      
      // Check for duplicate IP addresses
      if (processedIPs.has(deviceConfig.ip)) {
        this.log.error('Failed to initialize device:', new Error(`Duplicate IP address detected: ${deviceConfig.ip}`));
        continue;
      }
      
      // Mark this IP as processed
      processedIPs.add(deviceConfig.ip);
      
      // Use IP as the key to handle potential duplicates between config and discovery
      // Preserve all properties including feature flags
      discoveredDevicesMap.set(deviceConfig.ip, { ...deviceConfig });
      this.log.debug(`Found configured device: ${deviceConfig.name} (${deviceConfig.ip})`);
    }

    if (enableDiscovery) {
      // 2. Perform network discovery (if enabled, add config option later)
      // For now, let's assume discovery is always attempted
      this.log.info('Starting network discovery for TFIAC devices...');
      try {
        const networkDiscoveredIPs = await this.discoverDevicesNetwork(5000); // Discover for 5 seconds
        this.log.info(`Network discovery finished. Found ${networkDiscoveredIPs.size} potential devices.`);
        for (const ip of networkDiscoveredIPs) {
          if (!discoveredDevicesMap.has(ip)) {
            // Add newly discovered device if not already configured
            discoveredDevicesMap.set(ip, { ip: ip, name: `TFIAC ${ip}` }); // Default name
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
      // Proceed to remove any stale accessories even when no devices are configured or discovered
    }

    // 3. Register or update accessories based on the combined list
    const currentAccessoryUUIDs = new Set<string>();

    for (const device of allDevices) {
      const uuid = this.api.hap.uuid.generate(device.ip + (device.name || ''));
      currentAccessoryUUIDs.add(uuid);

      const existingAccessory = this.accessories.find((acc) => acc.UUID === uuid);

      const deviceConfigForAccessory: TfiacDeviceConfig = {
        ...(device as TfiacDeviceConfig),
        name: device.name || `TFIAC ${device.ip}`,
      };

      if (existingAccessory) {
        // Check if config has changed
        const prevConfig = existingAccessory.context.deviceConfig as TfiacDeviceConfig | undefined;
        const configChanged = !prevConfig ||
          prevConfig.name !== deviceConfigForAccessory.name ||
          prevConfig.ip !== deviceConfigForAccessory.ip ||
          prevConfig.port !== deviceConfigForAccessory.port;

        // Remove services that have been disabled in the config
        this.removeDisabledServices(existingAccessory, deviceConfigForAccessory);

        // Always update context.deviceConfig so that feature flags (e.g., enableTemperature) are current
        existingAccessory.context.deviceConfig = deviceConfigForAccessory;

        if (configChanged) {
          this.log.info(`Updating existing accessory: ${deviceConfigForAccessory.name} (${device.ip})`);
          existingAccessory.context.deviceConfig = deviceConfigForAccessory;
          existingAccessory.displayName = deviceConfigForAccessory.name;
          // Set device category for proper HomeKit behavior
          existingAccessory.category = this.api.hap.Categories.AIR_CONDITIONER;
          this.api.updatePlatformAccessories([existingAccessory]);
        }
        try {
          if (!this.discoveredAccessories.has(uuid)) {
            const tfiacAccessory = new TfiacPlatformAccessory(this, existingAccessory);
            this.discoveredAccessories.set(uuid, tfiacAccessory);
            this.setupOptionalAccessories(existingAccessory, deviceConfigForAccessory, uuid);
          }
        } catch (error) {
          this.log.error('Failed to initialize device:', error);
        }
      } else {
        // Create new accessory
        this.log.info(`Adding new accessory: ${deviceConfigForAccessory.name} (${device.ip})`);
        const accessory = new this.api.platformAccessory(deviceConfigForAccessory.name, uuid);
        // Set device category for proper HomeKit behavior
        accessory.category = this.api.hap.Categories.AIR_CONDITIONER;
        accessory.context.deviceConfig = deviceConfigForAccessory;
        try {
          const tfiacAccessory = new TfiacPlatformAccessory(this, accessory);
          this.discoveredAccessories.set(uuid, tfiacAccessory);
          this.setupOptionalAccessories(accessory, deviceConfigForAccessory, uuid);
          // Remove any services for disabled features before registering the accessory
          this.removeDisabledServices(accessory, deviceConfigForAccessory);
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          // Track the newly added accessory for future updates and removals
          this.accessories.push(accessory);
        } catch (error) {
          this.log.error('Failed to initialize device:', error);
        }
      }
    }

    // 4. Unregister accessories that are no longer found/configured
    const accessoriesToRemove = this.accessories.filter(acc => !currentAccessoryUUIDs.has(acc.UUID));
    if (accessoriesToRemove.length > 0) {
      this.log.info(`Removing ${accessoriesToRemove.length} stale accessories.`);
      accessoriesToRemove.forEach(acc => {
        this.cleanupOptionalAccessories(acc.UUID);
      });
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, accessoriesToRemove);
      // Remove stale accessories from internal cache
      accessoriesToRemove.forEach(acc => {
        const idx = this.accessories.findIndex(a => a.UUID === acc.UUID);
        if (idx > -1) {
          this.accessories.splice(idx, 1);
        }
      });
    }
  }

  /**
   * Performs UDP broadcast to discover TFIAC devices on the network.
   * @param timeoutMs - Duration to listen for responses.
   * @returns A Promise resolving to a Set of discovered IP addresses.
   */
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
      
      // Helper function to cleanup and resolve the promise with discovered IPs
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
              // Don't call cleanupAndResolve here, as we want to continue listening until timeout
            }
          } else {
            this.log.debug(`Ignoring non-XML/non-status response from ${rinfo.address}`, xmlString);
            // Don't call cleanupAndResolve here, as we want to continue listening until timeout
          }
        } catch (parseError) {
          this.log.debug(`Error parsing response from ${rinfo.address}:`, parseError);
          // Don't call cleanupAndResolve here, as we want to continue listening until timeout
        }
      });

      socket.on('listening', () => {
        try {
          socket.setBroadcast(true);
          this.log.debug(`Discovery socket listening on ${socket.address().address}:${socket.address().port}`);
          socket.send(discoveryMessage, discoveryPort, broadcastAddress, (err) => {
            if (err) {
              this.log.error('Error sending discovery broadcast:', err);
              // Continue with discovery even if broadcast fails
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

  /**
   * Homebridge will call this method for restored cached accessories.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info(`Loading accessory from cache: ${accessory.displayName}`);
    // Ensure the category is set for cached accessories
    accessory.category = this.api.hap.Categories.AIR_CONDITIONER;
    this.accessories.push(accessory);
  }

  /**
   * Removes services from an accessory that are disabled in the configuration.
   * @param accessory - The accessory to update.
   * @param deviceConfig - The configuration for the device.
   */
  private removeDisabledServices(accessory: PlatformAccessory, deviceConfig: TfiacDeviceConfig) {
    const servicesToRemove: ServiceRemovalConfig[] = [
      { configFlag: 'enableDisplay', serviceName: 'Display', logMessage: 'Display Switch' },
      { configFlag: 'enableSleep', serviceName: 'Sleep', logMessage: 'Sleep Switch' },
      { configFlag: 'enableFanSpeed', serviceName: 'Fan Speed', logMessage: 'Fan Speed' },
      { configFlag: 'enableDry', serviceName: 'Dry', logMessage: 'Dry Mode' },
      { configFlag: 'enableFanOnly', serviceName: 'Fan Only', logMessage: 'Fan Only Mode' },
      { configFlag: 'enableStandaloneFan', serviceName: 'Standalone Fan', logMessage: 'Standalone Fan' },
      { configFlag: 'enableHorizontalSwing', serviceName: 'Horizontal Swing', logMessage: 'Horizontal Swing' },
      { configFlag: 'enableTurbo', serviceName: 'Turbo', logMessage: 'Turbo' },
      { configFlag: 'enableEco', serviceName: 'Eco', logMessage: 'Eco' },
      { configFlag: 'enableBeep', serviceName: 'Beep', logMessage: 'Beep' },
    ];

    let serviceRemoved = false;

    servicesToRemove.forEach(({ configFlag, serviceName, logMessage }) => {
      if (deviceConfig[configFlag] === false) {
        // Try finding by name first (for accessories created with specific names)
        let service = accessory.getService(serviceName);
        // If not found by name, try finding by subtype (for accessories created with subtypes)
        if (!service) {
          // Generate potential subtype from serviceName (lowercase, no spaces)
          const subtype = serviceName.toLowerCase().replace(/ /g, '');
          // Assume Switch service for these optional accessories
          service = accessory.getServiceById(this.Service.Switch.UUID, subtype);
          // Add specific checks if other service types are used (e.g., Fanv2 for FanSpeed)
          if (!service && serviceName === 'Standalone Fan') {
            service = accessory.getServiceById(this.Service.Fan.UUID, 'standalone_fan');
          }
          if (!service && serviceName === 'Fan Speed') {
            service = accessory.getServiceById(this.Service.Fanv2.UUID, 'fanspeed');
          }
        }

        if (service) {
          accessory.removeService(service);
          this.log.info(`Removed ${logMessage} service from ${accessory.displayName}`);
          serviceRemoved = true;
        } else {
          this.log.debug(`${logMessage} service already disabled or not found for ${accessory.displayName}.`);
        }
      }
    });

    // Special handling for Temperature Sensor(s) - potentially multiple
    if (deviceConfig.enableTemperature === false) {
      // Find ALL temperature sensor services by UUID, regardless of name or subtype
      const tempSensorServices = accessory.services.filter(
        service => service.UUID === this.api.hap.Service.TemperatureSensor.UUID,
      );

      if (tempSensorServices.length > 0) {
        this.log.info(`Temperature sensor is disabled for ${accessory.displayName}. Removing ${tempSensorServices.length} sensor(s).`);
        tempSensorServices.forEach(service => {
          accessory.removeService(service);
          this.log.debug(`Removed temperature sensor service "${service.displayName || 'unnamed'}" (UUID: ${service.UUID}, Subtype: ${service.subtype})`);
          serviceRemoved = true;
        });
      } else {
        this.log.debug(`Temperature sensor already disabled or not found for ${accessory.displayName}.`);
      }
    }

    // Apply the updated accessory to HomeKit only if changes were made
    if (serviceRemoved) {
      this.log.info(`Updating accessory ${accessory.displayName} after removing disabled services.`);
      this.api.updatePlatformAccessories([accessory]);
    } else {
      this.log.debug(`No services needed removal for ${accessory.displayName}.`);
    }
  }

  /**
   * Create optional accessories based on the device configuration
   * @param accessory - The platform accessory to add optional features to
   * @param deviceConfig - The device configuration containing feature flags
   * @param uuid - The unique identifier for the accessory
   */
  private setupOptionalAccessories(
    accessory: PlatformAccessory, 
    deviceConfig: TfiacDeviceConfig, 
    uuid: string,
  ): void {
    for (const config of this.optionalAccessoryConfigs) {
      const { configFlag, accessoryClass, accessoryMap, displayName, defaultValue = false } = config;
      const isEnabled = deviceConfig[configFlag] ?? defaultValue;
      
      // If the feature is explicitly disabled, log that we're skipping it
      if (deviceConfig[configFlag] === false) {
        this.log.info(`Skipping ${displayName} for ${deviceConfig.name} as it is disabled in config.`);
        continue;
      }
      
      // Otherwise, if it's enabled (either explicitly or by default), create the accessory
      if (isEnabled) {
        const instance = new accessoryClass(this, accessory);
        accessoryMap.set(uuid, instance);
      }
    }
  }

  /**
   * Clean up optional accessories by stopping polling and removing them from maps
   * @param uuid - The unique identifier of the accessory to clean up
   */
  private cleanupOptionalAccessories(uuid: string): void {
    // First clean up the main TfiacPlatformAccessory
    const tfiacAcc = this.discoveredAccessories.get(uuid);
    if (tfiacAcc) {
      tfiacAcc.stopPolling();
      this.discoveredAccessories.delete(uuid);
    }
    
    // Then clean up all optional accessories
    for (const config of this.optionalAccessoryConfigs) {
      const instance = config.accessoryMap.get(uuid);
      if (instance) {
        // Call stopPolling if defined on the instance
        (instance as { stopPolling?: () => void }).stopPolling?.();
        config.accessoryMap.delete(uuid);
      }
    }

    // Manually clean up any maps that might not be in the optionalAccessoryConfigs
    // This ensures backward compatibility with tests expecting direct map cleanup
    this.displayAccessories.delete(uuid);
    this.sleepAccessories.delete(uuid);
    this.fanSpeedAccessories.delete(uuid);
    this.dryAccessories.delete(uuid);
    this.fanOnlyAccessories.delete(uuid);
    this.standaloneFanAccessories.delete(uuid);
    this.horizontalSwingAccessories.delete(uuid);
    this.turboAccessories.delete(uuid);
    this.ecoAccessories.delete(uuid);
    this.beepAccessories.delete(uuid);
  }
}