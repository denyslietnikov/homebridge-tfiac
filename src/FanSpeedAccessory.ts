import {
  PlatformAccessory,
  Service,
  CharacteristicValue,
  CharacteristicSetCallback,
  CharacteristicGetCallback,
} from 'homebridge';
import { TfiacPlatform } from './platform.js';
import { TfiacDeviceConfig } from './settings.js';
import CacheManager from './CacheManager.js';
import { OperationMode, FanSpeed, SleepModeState, PowerState, FanSpeedPercentMap } from './enums.js';
import { DeviceState } from './state/DeviceState.js';

export class FanSpeedAccessory {
  private service: Service;
  private cacheManager: CacheManager;
  private stateChangeListener: (state: DeviceState) => void;
  private deviceState: DeviceState;
  private debounceTimer?: NodeJS.Timeout;

  constructor(
    private readonly platform: TfiacPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const serviceName = 'Fan Speed';
    
    const deviceConfig = this.accessory.context.deviceConfig as TfiacDeviceConfig;
    this.cacheManager = CacheManager.getInstance(deviceConfig); // Updated: Pass only deviceConfig
    this.deviceState = this.cacheManager.getDeviceState();

    this.service =
      this.accessory.getServiceById(this.platform.Service.Fanv2, 'fan_speed') ||
      this.accessory.addService(this.platform.Service.Fanv2, serviceName, 'fan_speed');
    
    this.service.setCharacteristic(this.platform.Characteristic.ConfiguredName, serviceName);

    this.stateChangeListener = this.handleStateChange.bind(this);
    this.deviceState.on('stateChanged', this.stateChangeListener);
    
    const activeChar = this.service.getCharacteristic(this.platform.Characteristic.Active);
    if (typeof activeChar.onSet === 'function') {
      activeChar.onSet(this.handleActiveSet.bind(this));
    } else {
      activeChar
        .on('get', (callback: CharacteristicGetCallback) => callback(null, this.handleActiveGet() as number))
        .on('set', this.handleActiveSetLegacy.bind(this));
    }

    const rotationSpeedChar = this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed);
    if (typeof rotationSpeedChar.onSet === 'function') {
      rotationSpeedChar.onSet(this.handleRotationSpeedSet.bind(this));
    } else {
      rotationSpeedChar
        .on('get', (callback: CharacteristicGetCallback) => callback(null, this.handleRotationSpeedGet() as number))
        .on('set', this.handleRotationSpeedSetLegacy.bind(this));
    }

    this.handleStateChange(this.deviceState);
  }

  public stopPolling(): void {
    if (this.stateChangeListener) {
      this.deviceState.removeListener('stateChanged', this.stateChangeListener);
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.platform.log.debug('[FanSpeedAccessory] Polling stopped and listeners removed.');
  }

  private handleStateChange(state: DeviceState): void {
    this.platform.log.debug(`[FanSpeedAccessory] Received stateChanged: Power: ${state.power}, Mode: ${state.operationMode}, Fan: ${state.fanSpeed}`);
    const isActive = state.power === PowerState.On && this.isFanControlAllowedForMode(state.operationMode);
    
    this.service.updateCharacteristic(
      this.platform.Characteristic.Active,
      isActive ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE,
    );

    let rotationSpeedValue: number;
    if (!isActive) {
      rotationSpeedValue = 0;
    } else if (state.turboMode === PowerState.On) {
      rotationSpeedValue = FanSpeedPercentMap[FanSpeed.Turbo];
    } else if (state.sleepMode === SleepModeState.On) { // Assuming SleepModeState.On is the correct check for sleep mode active
      rotationSpeedValue = FanSpeedPercentMap[FanSpeed.Silent]; // Changed from Low to Silent
    } else {
      rotationSpeedValue = FanSpeedPercentMap[state.fanSpeed] ?? FanSpeedPercentMap[FanSpeed.Auto];
    }
    
    this.service.updateCharacteristic(
      this.platform.Characteristic.RotationSpeed,
      rotationSpeedValue,
    );
  }

  private isFanControlAllowedForMode(mode: OperationMode | undefined): boolean {
    if (!mode) {
      return false;
    }
    return mode !== OperationMode.Auto && mode !== OperationMode.Dry;
  }

  private handleActiveGet(): CharacteristicValue {
    const isActive = this.deviceState.power === PowerState.On && this.isFanControlAllowedForMode(this.deviceState.operationMode);
    const activeState = isActive ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE;
    this.platform.log.debug(`[FanSpeedAccessory] GET Active: ${activeState}`);
    return activeState;
  }

  private async handleActiveSet(value: CharacteristicValue): Promise<void> {
    this.platform.log.info(`[FanSpeedAccessory] SET Active to: ${value}`);
    const desiredState = this.deviceState.clone();

    if (value === this.platform.Characteristic.Active.ACTIVE) {
      desiredState.setPower(PowerState.On);
      if (!this.isFanControlAllowedForMode(desiredState.operationMode)) {
        desiredState.setOperationMode(OperationMode.Cool); 
      }
    } else {
      desiredState.setPower(PowerState.Off);
    }

    try {
      await this.cacheManager.applyStateToDevice(desiredState);
      return;
    } catch (error) {
      this.platform.log.error(`[FanSpeedAccessory] Error setting Active state: ${error}`);
      throw error; // will be handled by Homebridge when using onSet()
    }
  }

  private handleRotationSpeedGet(): CharacteristicValue {
    const state = this.deviceState;
    const isActive = state.power === PowerState.On && this.isFanControlAllowedForMode(state.operationMode);
    
    let rotationSpeedValue: number;
    if (!isActive) {
      rotationSpeedValue = 0;
    } else if (state.turboMode === PowerState.On) {
      rotationSpeedValue = FanSpeedPercentMap[FanSpeed.Turbo];
    } else if (state.sleepMode === SleepModeState.On) {
      rotationSpeedValue = FanSpeedPercentMap[FanSpeed.Silent];
    } else {
      rotationSpeedValue = FanSpeedPercentMap[state.fanSpeed] ?? FanSpeedPercentMap[FanSpeed.Auto];
    }
    this.platform.log.debug(`[FanSpeedAccessory] GET RotationSpeed: ${rotationSpeedValue}%`);
    return rotationSpeedValue;
  }

  private async handleRotationSpeedSet(value: CharacteristicValue): Promise<void> {
    const speedPercent = value as number;
    const fanMode = this.mapRotationSpeedToFanMode(speedPercent);
    
    this.platform.log.info(`[FanSpeedAccessory] SET RotationSpeed to ${speedPercent}% (mapped to: ${fanMode})`);

    // Optimistic update: If current fan speed is 100% (Turbo) and new speed is lower, 
    // immediately update the Turbo switch to "off" for better UI responsiveness
    const currentSpeed = this.handleRotationSpeedGet();
    if (currentSpeed === 100 && speedPercent < 100) {
      const turboSwitchService = this.accessory.getServiceById(this.platform.Service.Switch.UUID, 'turbo');
      if (turboSwitchService) {
        this.platform.log.debug('[FanSpeedAccessory] Optimistically updating Turbo switch to OFF due to fan speed reduction from 100%');
        turboSwitchService.updateCharacteristic(this.platform.Characteristic.On, false);
      }
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    
    this.debounceTimer = setTimeout(async () => {
      try {
        const desiredState = this.cacheManager.getDeviceState().clone();
        desiredState.setFanSpeed(fanMode);
        
        await this.cacheManager.applyStateToDevice(desiredState);
      } catch (error) {
        this.platform.log.error(`[FanSpeedAccessory] Error setting RotationSpeed via debounced call: ${error}`);
      }
    }, 500);

    return;
  }

  // ----- Wrapper methods for Legacy API (expects callback) -----
  private handleActiveSetLegacy(value: CharacteristicValue, callback: CharacteristicSetCallback): void {
    this.handleActiveSet(value)
      .then(() => callback(null))
      .catch(err => callback(err as Error));
  }

  private handleRotationSpeedSetLegacy(value: CharacteristicValue, callback: CharacteristicSetCallback): void {
    this.handleRotationSpeedSet(value)
      .then(() => callback(null))
      .catch(err => callback(err as Error));
  }

  private mapRotationSpeedToFanMode(speed: number): FanSpeed {
    if (speed === 0) {
      return FanSpeed.Auto;
    }
    if (speed <= (FanSpeedPercentMap[FanSpeed.Low] + FanSpeedPercentMap[FanSpeed.Silent]) / 2 && speed > 0) {
      return FanSpeed.Silent;
    }
    if (speed <= FanSpeedPercentMap[FanSpeed.Low]) {
      return FanSpeed.Low;
    }
    if (speed <= (FanSpeedPercentMap[FanSpeed.Low] + FanSpeedPercentMap[FanSpeed.MediumLow]) / 2) {
      return FanSpeed.Low;
    }
    if (speed <= FanSpeedPercentMap[FanSpeed.MediumLow]) {
      return FanSpeed.MediumLow;
    }
    if (speed <= (FanSpeedPercentMap[FanSpeed.MediumLow] + FanSpeedPercentMap[FanSpeed.Medium]) / 2) {
      return FanSpeed.MediumLow;
    }
    if (speed <= FanSpeedPercentMap[FanSpeed.Medium]) {
      return FanSpeed.Medium;
    }
    if (speed <= (FanSpeedPercentMap[FanSpeed.Medium] + FanSpeedPercentMap[FanSpeed.MediumHigh]) / 2) {
      return FanSpeed.Medium;
    }
    if (speed <= FanSpeedPercentMap[FanSpeed.MediumHigh]) {
      return FanSpeed.MediumHigh;
    }
    if (speed <= (FanSpeedPercentMap[FanSpeed.MediumHigh] + FanSpeedPercentMap[FanSpeed.High]) / 2) {
      return FanSpeed.MediumHigh;
    }
    if (speed < FanSpeedPercentMap[FanSpeed.High]) {
      return FanSpeed.High;
    }
    // When speed is exactly 100 or more, return Turbo
    return FanSpeed.Turbo;
  }
}
