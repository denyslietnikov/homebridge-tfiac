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

export class TfiacPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

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

  constructor(
    public readonly log: Logger,
    public readonly config: TfiacPlatformConfig, // Use specific type
    public readonly api: API,
  ) {
    // Initialize Service and Characteristic after api is assigned
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    this.log.debug('TfiacPlatform constructor called');

    // Homebridge will fire "didFinishLaunching" when it has loaded all configs
    this.api.on('didFinishLaunching', async () => {
      this.log.debug('didFinishLaunching callback');
      await this.discoverDevices(); // Make discoverDevices async
    });
  }

  /**
   * Discover devices from config and optionally via network broadcast.
   */
  async discoverDevices() {
    const configuredDevices = (this.config.devices || []) as TfiacDeviceConfig[];
    const discoveredDevicesMap = new Map<string, DiscoveredDevice>();
    const enableDiscovery = this.config.enableDiscovery !== false; // default true

    // 1. Process configured devices first
    for (const deviceConfig of configuredDevices) {
      if (!deviceConfig.ip) {
        this.log.error('Missing required IP address for configured device:', deviceConfig.name);
        continue;
      }
      // Use IP as the key to handle potential duplicates between config and discovery
      discoveredDevicesMap.set(deviceConfig.ip, {
        ip: deviceConfig.ip,
        name: deviceConfig.name,
        port: deviceConfig.port,
        // Include other config properties if needed later
      });
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
        name: device.name || `TFIAC ${device.ip}`,
        ip: device.ip,
        port: device.port,
      };

      if (existingAccessory) {
        // Check if config has changed
        const prevConfig = existingAccessory.context.deviceConfig as TfiacDeviceConfig | undefined;
        const configChanged = !prevConfig ||
          prevConfig.name !== deviceConfigForAccessory.name ||
          prevConfig.ip !== deviceConfigForAccessory.ip ||
          prevConfig.port !== deviceConfigForAccessory.port;

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
            // Check enable flags before creating accessories
            if (deviceConfigForAccessory.enableDisplay === false) {
              this.log.info(`Skipping Display Switch for ${deviceConfigForAccessory.name} as it is disabled in config.`);
            } else {
              const displaySwitch = new DisplaySwitchAccessory(this, existingAccessory);
              this.displayAccessories.set(uuid, displaySwitch);
            }

            if (deviceConfigForAccessory.enableSleep === false) {
              this.log.info(`Skipping Sleep Switch for ${deviceConfigForAccessory.name} as it is disabled in config.`);
            } else {
              const sleepSwitch = new SleepSwitchAccessory(this, existingAccessory);
              this.sleepAccessories.set(uuid, sleepSwitch);
            }

            const fanSpeed = new FanSpeedAccessory(this, existingAccessory);
            this.fanSpeedAccessories.set(uuid, fanSpeed);
            const drySwitch = new DrySwitchAccessory(this, existingAccessory);
            this.dryAccessories.set(uuid, drySwitch);
            const fanOnlySwitch = new FanOnlySwitchAccessory(this, existingAccessory);
            this.fanOnlyAccessories.set(uuid, fanOnlySwitch);
            const standaloneFan = new StandaloneFanAccessory(this, existingAccessory);
            this.standaloneFanAccessories.set(uuid, standaloneFan);
            const horizontalSwing = new HorizontalSwingSwitchAccessory(this, existingAccessory);
            this.horizontalSwingAccessories.set(uuid, horizontalSwing);
            const turboSwitch = new TurboSwitchAccessory(this, existingAccessory);
            this.turboAccessories.set(uuid, turboSwitch);
            const ecoSwitch = new EcoSwitchAccessory(this, existingAccessory);
            this.ecoAccessories.set(uuid, ecoSwitch);
            const beepSwitch = new BeepSwitchAccessory(this, existingAccessory);
            this.beepAccessories.set(uuid, beepSwitch);
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
          // Check enable flags before creating accessories
          if (deviceConfigForAccessory.enableDisplay === false) {
            this.log.info(`Skipping Display Switch for ${deviceConfigForAccessory.name} as it is disabled in config.`);
          } else {
            const displaySwitch = new DisplaySwitchAccessory(this, accessory);
            this.displayAccessories.set(uuid, displaySwitch);
          }

          if (deviceConfigForAccessory.enableSleep === false) {
            this.log.info(`Skipping Sleep Switch for ${deviceConfigForAccessory.name} as it is disabled in config.`);
          } else {
            const sleepSwitch = new SleepSwitchAccessory(this, accessory);
            this.sleepAccessories.set(uuid, sleepSwitch);
          }

          const fanSpeed = new FanSpeedAccessory(this, accessory);
          this.fanSpeedAccessories.set(uuid, fanSpeed);
          const drySwitch = new DrySwitchAccessory(this, accessory);
          this.dryAccessories.set(uuid, drySwitch);
          const fanOnlySwitch = new FanOnlySwitchAccessory(this, accessory);
          this.fanOnlyAccessories.set(uuid, fanOnlySwitch);
          const standaloneFan = new StandaloneFanAccessory(this, accessory);
          this.standaloneFanAccessories.set(uuid, standaloneFan);
          const horizontalSwing = new HorizontalSwingSwitchAccessory(this, accessory);
          this.horizontalSwingAccessories.set(uuid, horizontalSwing);
          const turboSwitch = new TurboSwitchAccessory(this, accessory);
          this.turboAccessories.set(uuid, turboSwitch);
          const ecoSwitch = new EcoSwitchAccessory(this, accessory);
          this.ecoAccessories.set(uuid, ecoSwitch);
          const beepSwitch = new BeepSwitchAccessory(this, accessory);
          this.beepAccessories.set(uuid, beepSwitch);
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
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
        const tfiacAcc = this.discoveredAccessories.get(acc.UUID);
        if (tfiacAcc) {
          tfiacAcc.stopPolling(); // Clean up polling interval
          this.discoveredAccessories.delete(acc.UUID);
        }
        // Stop polling for Display Switch
        const displaySwitch = this.displayAccessories.get(acc.UUID);
        if (displaySwitch) {
          displaySwitch.stopPolling();
          this.displayAccessories.delete(acc.UUID);
        }
        // Stop polling for Sleep Switch
        const sleepSwitch = this.sleepAccessories.get(acc.UUID);
        if (sleepSwitch) {
          sleepSwitch.stopPolling();
          this.sleepAccessories.delete(acc.UUID);
        }
        // Stop polling for Fan Speed
        const fanSpeed = this.fanSpeedAccessories.get(acc.UUID);
        if (fanSpeed) {
          fanSpeed.stopPolling();
          this.fanSpeedAccessories.delete(acc.UUID);
        }
        // Stop polling for Dry Switch
        const drySwitch = this.dryAccessories.get(acc.UUID);
        if (drySwitch) {
          drySwitch.stopPolling();
          this.dryAccessories.delete(acc.UUID);
        }
        // Stop polling for Fan Only Switch
        const fanOnlySwitch = this.fanOnlyAccessories.get(acc.UUID);
        if (fanOnlySwitch) {
          fanOnlySwitch.stopPolling();
          this.fanOnlyAccessories.delete(acc.UUID);
        }
        // Stop polling for Standalone Fan
        const standaloneFan = this.standaloneFanAccessories.get(acc.UUID);
        if (standaloneFan) {
          standaloneFan.stopPolling();
          this.standaloneFanAccessories.delete(acc.UUID);
        }
        // Stop polling for Horizontal Swing
        const horizontalSwing = this.horizontalSwingAccessories.get(acc.UUID);
        if (horizontalSwing) {
          horizontalSwing.stopPolling();
          this.horizontalSwingAccessories.delete(acc.UUID);
        }
        // Stop polling for Turbo Switch
        const turboSwitch = this.turboAccessories.get(acc.UUID);
        if (turboSwitch) {
          turboSwitch.stopPolling();
          this.turboAccessories.delete(acc.UUID);
        }
        // Stop polling for Eco Switch
        const ecoSwitch = this.ecoAccessories.get(acc.UUID);
        if (ecoSwitch) {
          ecoSwitch.stopPolling();
          this.ecoAccessories.delete(acc.UUID);
        }
        // Stop polling for Beep Switch
        const beepSwitch = this.beepAccessories.get(acc.UUID);
        if (beepSwitch) {
          beepSwitch.stopPolling();
          this.beepAccessories.delete(acc.UUID);
        }
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
    return new Promise((resolve, reject) => {
      const discoveredIPs = new Set<string>();
      const discoveryMessage = Buffer.from(
        `<msg msgid="SyncStatusReq" type="Control" seq="${Date.now() % 10000000}">` +
        '<SyncStatusReq></SyncStatusReq></msg>',
      );
      const broadcastAddress = '255.255.255.255';
      const discoveryPort = 7777; // Standard TFIAC port

      const socket = dgram.createSocket('udp4');
      let discoveryTimeout: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (discoveryTimeout) {
          clearTimeout(discoveryTimeout);
          discoveryTimeout = null;
        }
        try {
          socket.close(() => {
            this.log.debug('Discovery socket closed.');
          });
        } catch (e) {
          this.log.debug('Error closing discovery socket:', e);
        }
      };

      socket.on('error', (err) => {
        this.log.error('Discovery socket error:', err);
        cleanup();
        reject(err);
      });

      socket.on('message', async (msg, rinfo) => {
        this.log.debug(`Received discovery response from ${rinfo.address}:${rinfo.port}`);
        // Basic validation: Check if it's likely a TFIAC XML response
        try {
          const xmlString = msg.toString();
          if (xmlString.includes('<statusUpdateMsg>')) {
            // Attempt to parse for more robust validation
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

      // Add listener for the 'listening' event
      socket.on('listening', () => {
        try {
          // Now it's safe to set broadcast flag
          socket.setBroadcast(true);
          this.log.debug(`Discovery socket listening on ${socket.address().address}:${socket.address().port}`);
          
          // Send discovery broadcast
          socket.send(discoveryMessage, discoveryPort, broadcastAddress, (err) => {
            if (err) {
              this.log.error('Error sending discovery broadcast:', err);
            } else {
              this.log.debug('Discovery broadcast message sent.');
            }
          });
        } catch (err) {
          this.log.error('Error setting up broadcast:', err);
          cleanup();
          reject(err);
        }
      });

      try {
        // Start discovery by binding the socket
        socket.bind();
        
        // Set timeout to stop discovery
        discoveryTimeout = setTimeout(() => {
          this.log.debug('Discovery timeout reached.');
          cleanup();
          resolve(discoveredIPs);
        }, timeoutMs);
      } catch (err) {
        this.log.error('Error setting up discovery socket:', err);
        cleanup();
        reject(err);
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
}