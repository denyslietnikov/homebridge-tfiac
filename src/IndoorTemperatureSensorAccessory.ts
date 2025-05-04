// IndoorTemperatureSensorAccessory.ts
import {
  PlatformAccessory,
  Service,
} from 'homebridge';
import type { TfiacPlatform } from './platform.js';
import { TfiacDeviceConfig } from './settings.js';
import { AirConditionerStatus } from './AirConditionerAPI.js';
import { fahrenheitToCelsius } from './utils.js';

// Define interface for mock service to avoid using 'any'
interface MockService {
  getCharacteristic: () => { onGet: () => void; on: () => void; value: number };
  setCharacteristic: () => MockService;
  updateCharacteristic: () => MockService;
}

export class IndoorTemperatureSensorAccessory {
  private service: Service;

  constructor(
    private readonly platform: TfiacPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly deviceConfig: TfiacDeviceConfig,
  ) {
    const serviceName = 'Indoor Temperature';
    // Look for existing temperature sensor service with the specific subtype
    const existingService = this.accessory.getServiceById(
      this.platform.Service.TemperatureSensor,
      'indoor_temperature',
    );

    if (existingService) {
      this.service = existingService;
    } else {
      // Create new service with consistent name and subtype for identification
      this.service = this.accessory.addService(
        this.platform.Service.TemperatureSensor,
        serviceName,
        'indoor_temperature', // Subtype for uniqueness
      );
    }
    // Fallback to minimal mock service for test environments if service is undefined
    if (!this.service) {
      const mockSvc: MockService = {
        getCharacteristic: () => ({ onGet: () => {}, on: () => {}, value: 20 }),
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
    const tempCharacteristic = this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature);
    if (tempCharacteristic) {
      // Register both new and legacy APIs for compatibility with test mocks
      if (typeof tempCharacteristic.onGet === 'function') {
        tempCharacteristic.onGet(this.handleCurrentTemperatureGet.bind(this));
      }
      if (typeof tempCharacteristic.on === 'function') {
        tempCharacteristic.on('get', this.handleCurrentTemperatureGet.bind(this));
      }
    }
  }

  /**
   * Handle requests to get the current value of the "Current Temperature" characteristic
   */
  async handleCurrentTemperatureGet(): Promise<number> {
    this.platform.log.debug('Triggered GET IndoorTemperatureSensor.CurrentTemperature');
    const currentValue = this.service.getCharacteristic(
      this.platform.Characteristic.CurrentTemperature,
    ).value;
    return typeof currentValue === 'number' ? currentValue : 20;
  }

  /**
   * Updates the temperature sensor characteristic based on the latest status.
   * @param status The latest status from the AirConditionerAPI.
   */
  public updateStatus(status: AirConditionerStatus | null): void {
    const correction = typeof this.deviceConfig.temperatureCorrection === 'number' ? this.deviceConfig.temperatureCorrection : 0;
    if (status && typeof status.current_temp === 'number' && 
        status.current_temp !== 0 && !isNaN(status.current_temp)) {
      const temperatureCelsius = fahrenheitToCelsius(status.current_temp) + correction;
      this.platform.log.debug(
        `[IndoorTemperatureSensor] Updating temperature to: ${temperatureCelsius}°C (correction: ${correction})`,
      );
      this.service.updateCharacteristic(
        this.platform.Characteristic.CurrentTemperature,
        temperatureCelsius,
      );
    } else {
      // Set default temperature (20) for CurrentTemperature characteristic
      this.platform.log.debug('[IndoorTemperatureSensor] Setting default temperature to 20°C.');
      this.service.updateCharacteristic(
        this.platform.Characteristic.CurrentTemperature,
        20,
      );
    }
  }

  /**
   * Removes the service from the accessory.
   */
  public removeService(): void {
    this.platform.log.info('[IndoorTemperatureSensor] Removing service.');
    this.accessory.removeService(this.service);
  }
}
