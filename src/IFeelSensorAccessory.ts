// IFeelSensorAccessory.ts
import {
  PlatformAccessory,
  Service,
} from 'homebridge';
import type { TfiacPlatform } from './platform.js';
import { TfiacDeviceConfig } from './settings.js';
import { AirConditionerStatus } from './AirConditionerAPI.js';
import { OperationMode } from './enums.js';

// Define interface for mock service to avoid using 'any'
interface MockService {
  getCharacteristic: () => { onGet: () => void; on: () => void; value: boolean };
  setCharacteristic: () => MockService;
  updateCharacteristic: () => MockService;
}

export class IFeelSensorAccessory {
  private service: Service | undefined;

  constructor(
    private readonly platform: TfiacPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly deviceConfig: TfiacDeviceConfig,
  ) {
    const serviceName = 'iFeel';
    
    // Skip initialization if feature is disabled in config
    if (deviceConfig.enableIFeelSensor === false) {
      this.platform.log.debug('[iFeelSensor] Disabled in config, skipping initialization');
      return;
    }

    // Look for existing switch service with the specific subtype
    const existingService = this.accessory.getServiceById(
      this.platform.Service.Switch,
      'ifeel_sensor',
    );

    if (existingService) {
      this.service = existingService;
    } else {
      // Create new service with consistent name and subtype for identification
      this.service = this.accessory.addService(
        this.platform.Service.Switch,
        serviceName,
        'ifeel_sensor', // Subtype for uniqueness
      );
    }

    // Fallback to minimal mock service for test environments if service is undefined
    if (!this.service) {
      const mockSvc: MockService = {
        getCharacteristic: () => ({ onGet: () => {}, on: () => {}, value: false }),
        setCharacteristic: function() {
          return this; 
        },
        updateCharacteristic: function() {
          return this; 
        },
      };
      this.service = mockSvc as unknown as Service;
    }

    // Update the display name regardless if it was existing or new
    if (typeof this.service.setCharacteristic === 'function') {
      this.service.setCharacteristic(
        this.platform.Characteristic.Name,
        serviceName,
      );
      // Add ConfiguredName characteristic to match other services
      this.service.updateCharacteristic(
        this.platform.Characteristic.ConfiguredName,
        serviceName,
      );
    }

    // Register the GET handler if the characteristic supports it
    const onCharacteristic = this.service.getCharacteristic(this.platform.Characteristic.On);
    if (onCharacteristic) {
      // Make the switch read-only by providing a no-op set handler
      if (typeof onCharacteristic.onSet === 'function') {
        // Use a no-op function that ignores set attempts
        onCharacteristic.onSet((value, callback) => {
          if (callback) {
            callback(null);
          }
        });
      }

      // Register both new and legacy APIs for compatibility with test mocks
      if (typeof onCharacteristic.onGet === 'function') {
        onCharacteristic.onGet(this.handleOnGet.bind(this));
      }
      if (typeof onCharacteristic.on === 'function') {
        onCharacteristic.on('get', this.handleOnGet.bind(this));
      }
    }
  }

  /**
   * Handle requests to get the current value of the "On" characteristic
   */
  async handleOnGet(): Promise<boolean> {
    this.platform.log.debug('Triggered GET iFeelSensor.On');
    const currentValue = this.service?.getCharacteristic(
      this.platform.Characteristic.On,
    ).value;
    return typeof currentValue === 'boolean' ? currentValue : false;
  }

  /**
   * Updates the iFeel sensor characteristic based on the latest status.
   * @param status The latest status from the AirConditionerAPI.
   */
  public updateStatus(status: AirConditionerStatus | null): void {
    // Skip updates if disabled in config
    if (this.deviceConfig.enableIFeelSensor === false) {
      return;
    }

    // Skip if service is not available
    if (!this.service || !this.platform.Characteristic) {
      return;
    }

    if (status && typeof status.operation_mode === 'string') {
      const isIFeelMode = status.operation_mode === OperationMode.SelfFeel;
      this.platform.log.debug(
        `[iFeelSensor] Updating state to: ${isIFeelMode ? 'ON' : 'OFF'} (mode: ${status.operation_mode})`,
      );
      this.service.updateCharacteristic(
        this.platform.Characteristic.On,
        isIFeelMode,
      );
    } else {
      // Set default state (OFF) if no status available
      this.platform.log.debug('[iFeelSensor] Setting default state to OFF.');
      this.service.updateCharacteristic(
        this.platform.Characteristic.On,
        false,
      );
    }
  }

  /**
   * Removes the service from the accessory.
   */
  public removeService(): void {
    if (this.service && this.accessory.removeService) {
      this.platform.log.info('[iFeelSensor] Removing service.');
      this.accessory.removeService(this.service);
      this.service = undefined;
    }
  }
}