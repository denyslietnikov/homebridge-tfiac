// IndoorTemperatureSensorAccessory.ts
import {
  PlatformAccessory,
  Service,
  CharacteristicGetCallback,
} from 'homebridge';
import type { TfiacPlatform } from './platform.js';
import { TfiacDeviceConfig } from './settings.js';
import { AirConditionerStatus } from './AirConditionerAPI.js';
import { fahrenheitToCelsius } from './utils';

export class IndoorTemperatureSensorAccessory {
  private service: Service;

  constructor(
    private readonly platform: TfiacPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly deviceConfig: TfiacDeviceConfig,
  ) {
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
        'Indoor Temperature',
        'indoor_temperature', // Subtype for uniqueness
      );
    }

    // Update the display name regardless if it was existing or new
    this.service.setCharacteristic(
      this.platform.Characteristic.Name,
      'Indoor Temperature',
    );

    // Register the GET handler
    this.service
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .on('get', this.handleCurrentTemperatureGet.bind(this));
  }

  /**
   * Handle requests to get the current value of the "Current Temperature" characteristic
   */
  private handleCurrentTemperatureGet(callback: CharacteristicGetCallback): void {
    this.platform.log.debug('Triggered GET IndoorTemperatureSensor.CurrentTemperature');
    // The main accessory should handle fetching/caching the status.
    // We rely on the cachedStatus being passed to updateStatus.
    // For GET, we read the current characteristic value which should be up-to-date.
    const currentValue = this.service.getCharacteristic(
      this.platform.Characteristic.CurrentTemperature,
    ).value;
    callback(null, currentValue ?? 20); // Return default if value is somehow null
  }

  /**
   * Updates the temperature sensor characteristic based on the latest status.
   * @param status The latest status from the AirConditionerAPI.
   */
  public updateStatus(status: AirConditionerStatus | null): void {
    if (status) {
      const temperatureCelsius = fahrenheitToCelsius(status.current_temp);
      this.platform.log.debug(
        `[IndoorTemperatureSensor] Updating temperature to: ${temperatureCelsius}°C`,
      );
      this.service.updateCharacteristic(
        this.platform.Characteristic.CurrentTemperature,
        temperatureCelsius,
      );
    } else {
      this.platform.log.debug(
        '[IndoorTemperatureSensor] No status available, setting default temperature (20°C)',
      );
      // Optionally set a default value or leave it as is
      this.service.updateCharacteristic(
        this.platform.Characteristic.CurrentTemperature,
        20, // Default value when status is null
      );
    }
  }

  /**
   * Removes the service from the accessory.
   */
  public removeService(): void {
    this.platform.log.info(`Removing Indoor Temperature sensor service for ${this.deviceConfig.name}`);
    this.accessory.removeService(this.service);
  }
}
