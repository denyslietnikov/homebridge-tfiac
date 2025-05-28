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
// DeviceState mutators used: setSleepMode, setTurbo, setFanSpeed, setPower
import { OperationMode, FanSpeed, SleepModeState, PowerState, FanSpeedPercentMap } from './enums.js';
// Constants for RotationSpeed mapping
const AUTO_PERCENT = 50;      // Slider value that represents “Auto”
const TURBO_THRESHOLD = 95;   // Everything ≥ 95 % is treated as Turbo
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

    // Power-off ⇒ slider at 0 %
    if (!isActive) {
      rotationSpeedValue = 0;
    } else if (state.turboMode === PowerState.On || state.fanSpeed === FanSpeed.Turbo) {
      rotationSpeedValue = 100;
    } else if (state.sleepMode === SleepModeState.On) {
      // Sleep shows as Silent (lowest) – 15 %
      rotationSpeedValue = FanSpeedPercentMap[FanSpeed.Silent];
    } else if (state.fanSpeed === FanSpeed.Auto) {
      rotationSpeedValue = AUTO_PERCENT;
    } else {
      rotationSpeedValue = FanSpeedPercentMap[state.fanSpeed] ?? AUTO_PERCENT;
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

    if (!isActive) {
      this.platform.log.debug('[FanSpeedAccessory] GET RotationSpeed: 0 % (inactive)');
      return 0;
    }

    let pct: number;
    if (state.turboMode === PowerState.On || state.fanSpeed === FanSpeed.Turbo) {
      pct = 100;
    } else if (state.sleepMode === SleepModeState.On) {
      pct = FanSpeedPercentMap[FanSpeed.Silent];
    } else if (state.fanSpeed === FanSpeed.Auto) {
      pct = AUTO_PERCENT;
    } else {
      pct = FanSpeedPercentMap[state.fanSpeed] ?? AUTO_PERCENT;
    }
    this.platform.log.debug(`[FanSpeedAccessory] GET RotationSpeed: ${pct}%`);
    return pct;
  }

  private async handleRotationSpeedSet(value: CharacteristicValue): Promise<void> {
    const speedPercent = value as number;

    // 0 % ⇒ Power OFF
    if (speedPercent === 0) {
      this.platform.log.info('[FanSpeedAccessory] 0 % detected – powering OFF');
      const offState = this.cacheManager.getDeviceState().clone();
      offState.setPower(PowerState.Off);
      offState.setTurboMode(PowerState.Off);
      offState.setSleepMode(SleepModeState.Off);

      await this.cacheManager.applyStateToDevice(offState).catch(err => {
        this.platform.log.error(`[FanSpeedAccessory] Error powering off via speed slider: ${err}`);
      });

      // Optimistic UI update
      this.service.updateCharacteristic(this.platform.Characteristic.Active, this.platform.Characteristic.Active.INACTIVE);
      this.service.updateCharacteristic(this.platform.Characteristic.RotationSpeed, 0);
      return;
    }

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

        // Keep Turbo / Sleep mutual exclusivity
        if (fanMode === FanSpeed.Turbo) {
          desiredState.setTurboMode(PowerState.On);
          desiredState.setSleepMode(SleepModeState.Off);
        } else {
          desiredState.setTurboMode(PowerState.Off);
        }

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
    if (speed >= TURBO_THRESHOLD) {
      return FanSpeed.Turbo;
    }
    if (speed === 0) {
      // We will interpret 0 % as a pure power-off request; caller handles it.
      return FanSpeed.Auto;
    }
    if (speed >= 45 && speed <= 55) {
      return FanSpeed.Auto;
    }
    if (speed < FanSpeedPercentMap[FanSpeed.Silent]) {
      return FanSpeed.Silent;
    }
    if (speed < FanSpeedPercentMap[FanSpeed.Low]) {
      return FanSpeed.Low;
    }
    if (speed < FanSpeedPercentMap[FanSpeed.MediumLow]) {
      return FanSpeed.MediumLow;
    }
    if (speed < FanSpeedPercentMap[FanSpeed.Medium]) {
      return FanSpeed.Medium;
    }
    if (speed < FanSpeedPercentMap[FanSpeed.MediumHigh]) {
      return FanSpeed.MediumHigh;
    }
    return FanSpeed.High;
  }
}
