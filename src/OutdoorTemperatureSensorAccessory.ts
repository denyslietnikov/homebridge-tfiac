// OutdoorTemperatureSensorAccessory.ts
import {
  PlatformAccessory,
  Service,
  CharacteristicGetCallback,
} from 'homebridge';
import type { TfiacPlatform } from './platform.js';
import { TfiacDeviceConfig } from './settings.js';
import { AirConditionerStatus } from './AirConditionerAPI.js';
import { fahrenheitToCelsius } from './utils.js';

export class OutdoorTemperatureSensorAccessory {
  private service: Service | null = null;

  constructor(
    private readonly platform: TfiacPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly deviceConfig: TfiacDeviceConfig,
  ) {
    // Service creation/retrieval is handled dynamically in updateStatus
  }

  /**
   * Handle requests to get the current value of the "Current Temperature" characteristic
   */
  private handleCurrentTemperatureGet(callback: CharacteristicGetCallback): void {
    this.platform.log.debug('Triggered GET OutdoorTemperatureSensor.CurrentTemperature');
    // Similar to indoor sensor, rely on the characteristic's current value.
    const currentValue = this.service
      ? this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).value
      : null;
    callback(null, currentValue ?? 20); // Return default if service doesn't exist or value is null
  }

  /**
   * Updates the temperature sensor characteristic based on the latest status.
   * Creates or removes the service as needed.
   * @param status The latest status from the AirConditionerAPI.
   */
  public updateStatus(status: AirConditionerStatus | null): void {
    const enableTemperature = this.deviceConfig.enableTemperature !== false;
    const hasValidOutdoorTemp = status && typeof status.outdoor_temp === 'number' && status.outdoor_temp !== 0 && !isNaN(status.outdoor_temp);

    if (enableTemperature && hasValidOutdoorTemp) {
      if (!this.service) {
        this.platform.log.debug('[OutdoorTemperatureSensor] Adding service.');
        // Look for existing service first (by name or subtype if defined)
        this.service =
          this.accessory.getService('Outdoor Temperature') ||
          this.accessory.addService(
            this.platform.Service.TemperatureSensor,
            'Outdoor Temperature',
            'outdoor_temperature', // Add subtype for uniqueness
          );
        
        // Add check before calling setCharacteristic
        if (typeof this.service.setCharacteristic === 'function') {
          this.service.setCharacteristic(
            this.platform.Characteristic.Name,
            'Outdoor Temperature',
          );
        }
        
        // Add check before registering the 'get' handler
        const tempCharacteristic = this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature);
        if (tempCharacteristic && typeof tempCharacteristic.on === 'function') {
          tempCharacteristic.on('get', this.handleCurrentTemperatureGet.bind(this));
        }
      }
      // We know status and status.outdoor_temp are valid here
      const outdoorCelsius = fahrenheitToCelsius(status!.outdoor_temp!);
      this.platform.log.debug(
        `[OutdoorTemperatureSensor] Updating temperature to: ${outdoorCelsius}°C`,
      );
      this.service.updateCharacteristic(
        this.platform.Characteristic.CurrentTemperature,
        outdoorCelsius,
      );
    } else if (this.service) {
      // Remove the service if outdoor_temp is not available, zero, NaN, or temperature sensors are disabled
      this.platform.log.debug('[OutdoorTemperatureSensor] Removing service.');
      this.accessory.removeService(this.service);
      this.service = null;
    }
  }

  /**
   * Removes the service from the accessory if it exists.
   */
  public removeService(): void {
    if (this.service) {
      this.platform.log.info(`Removing Outdoor Temperature sensor service for ${this.deviceConfig.name}`);
      this.accessory.removeService(this.service);
      this.service = null;
    }
  }
}
