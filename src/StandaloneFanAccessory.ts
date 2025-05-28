import {
  PlatformAccessory,
  Service,
  CharacteristicValue,
} from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { AirConditionerStatus } from './AirConditionerAPI.js';
import { TfiacDeviceConfig } from './settings.js';
import { PowerState, FanSpeed } from './enums.js';
import CacheManager from './CacheManager.js';
import { DeviceState } from './state/DeviceState.js';

export class StandaloneFanAccessory {
  private service: Service;
  private cacheManager: CacheManager;
  private deviceState: DeviceState;
  private stateChangeListener: (state: DeviceState) => void;

  constructor(
    private readonly platform: TfiacPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const serviceName = 'Standalone Fan';
    const deviceConfig = this.accessory.context.deviceConfig as TfiacDeviceConfig;
    this.cacheManager = CacheManager.getInstance(deviceConfig, platform.log);
    this.deviceState = this.cacheManager.getDeviceState();
    this.stateChangeListener = this.handleStateChange.bind(this);

    const existingService =
      this.accessory.getService(serviceName) ||
      this.accessory.getServiceById(this.platform.Service.Fan, 'standalone_fan') ||
      this.accessory.getServiceById(this.platform.Service.Fan.UUID, 'standalone_fan');

    this.service =
      existingService ||
      this.accessory.addService(this.platform.Service.Fan, serviceName, 'standalone_fan');
    this.service.updateCharacteristic(this.platform.Characteristic.ConfiguredName, serviceName);

    // Subscribe to DeviceState changes for reactive UI updates
    this.deviceState.on('stateChanged', this.stateChangeListener);

    // Get the On characteristic
    const onCharacteristic = this.service.getCharacteristic(this.platform.Characteristic.On);
    onCharacteristic
      .onGet(this.handleOnGet.bind(this))
      .onSet(this.handleOnSet.bind(this));

    // Get the RotationSpeed characteristic
    const rotationSpeedCharacteristic = this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed);
    rotationSpeedCharacteristic
      .onGet(this.handleRotationSpeedGet.bind(this))
      .onSet(this.handleRotationSpeedSet.bind(this));
  }

  /** Unsubscribe from centralized status updates */
  public stopPolling(): void {
    // Unsubscribe from DeviceState events
    this.deviceState.removeListener('stateChanged', this.stateChangeListener);
  }

  /**
   * Handle state change events from the DeviceState
   */
  private handleStateChange(state: DeviceState): void {
    try {
      // Check if state is a valid DeviceState object with toApiStatus method
      if (!state || typeof state.toApiStatus !== 'function') {
        this.platform.log.warn('[StandaloneFan] Invalid DeviceState object received, toApiStatus is not a function');
        this.updateStatus(null);
        return;
      }
      
      const apiStatus = state.toApiStatus();
      this.updateStatus(apiStatus);
    } catch (error) {
      this.platform.log.error(`[StandaloneFan] Error in handleStateChange: ${error}`);
      this.updateStatus(null);
    }
  }

  /**
   * Update the service with the latest status
   */
  public updateStatus(status: Partial<AirConditionerStatus> | null): void {
    const isOn = status && status.is_on ? status.is_on === PowerState.On : false;
    this.service.updateCharacteristic(this.platform.Characteristic.On, isOn);
    const speed = status && typeof status.fan_mode === 'string'
      ? this.mapFanModeToRotationSpeed(status.fan_mode as FanSpeed)
      : 50;
    this.service.updateCharacteristic(this.platform.Characteristic.RotationSpeed, speed);
  }

  private async handleOnGet(): Promise<boolean> {
    const value = this.service.getCharacteristic(this.platform.Characteristic.On).value as boolean;
    return value ?? false;
  }

  private async handleOnSet(value: CharacteristicValue): Promise<void> {
    try {
      const modifiedState = this.deviceState.clone();
      
      if (value) {
        modifiedState.setPower(PowerState.On);
      } else {
        modifiedState.setPower(PowerState.Off);
      }
      
      await this.cacheManager.applyStateToDevice(modifiedState);
    } catch (err) {
      throw err;
    }
  }

  private async handleRotationSpeedGet(): Promise<number> {
    const value = this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed).value as number;
    return value ?? 50;
  }

  private async handleRotationSpeedSet(value: CharacteristicValue): Promise<void> {
    try {
      const modifiedState = this.deviceState.clone();
      
      // Set the fan speed while maintaining current sleep mode
      modifiedState.setFanSpeed(this.mapRotationSpeedToFanMode(value as number));
      
      await this.cacheManager.applyStateToDevice(modifiedState);
    } catch (err) {
      throw err;
    }
  }

  private mapFanModeToRotationSpeed(fanMode: FanSpeed): number {
    const fanSpeedMap: { [key in FanSpeed]?: number } = {
      [FanSpeed.Auto]: 50,
      [FanSpeed.Low]: 25,
      [FanSpeed.Medium]: 50,
      [FanSpeed.High]: 75,
    };
    return fanSpeedMap[fanMode] ?? 50; // Default to 50 if mode is unknown
  }

  private mapRotationSpeedToFanMode(speed: number): FanSpeed {
    if (speed === 0) {
      return FanSpeed.Auto;
    }

    if (speed <= 25) {
      return FanSpeed.Low;
    } else if (speed <= 50) {
      return FanSpeed.Medium;
    } else if (speed <= 75) {
      return FanSpeed.High;
    } else {
      return FanSpeed.Auto;
    }
  }
}