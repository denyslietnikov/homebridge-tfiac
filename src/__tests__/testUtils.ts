/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
console.log('[testUtils.ts] START LOADING');

// src/__tests__/testUtils.helper.ts
import {
  API,
  Categories,
  Characteristic,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  CharacteristicValue,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
  WithUUID,
} from 'homebridge';
import { vi, Mock } from 'vitest';
import { TfiacPlatform } from '../platform.js';
import { TfiacDeviceConfig } from '../settings.js';
import { PLATFORM_NAME } from '../settings.js';
import { PowerState, OperationMode, FanSpeed, SwingMode, SleepModeState } from '../enums';
import { EventEmitter } from 'events';
import type { AirConditionerStatus, DeviceOptions, PartialDeviceOptions as ApiPartialDeviceOptions } from '../AirConditionerAPI';
import type { DeviceState } from '../state/DeviceState.js';
console.log('[testUtils.ts] Imported types from AirConditionerAPI (AirConditionerStatus, DeviceOptions, PartialDeviceOptions)');

// Define mock cache manager type for tests
export type MockCacheManagerType = any;

// Define mock device state with toApiStatus as any so vitest mock methods work
export interface MockDeviceState extends EventEmitter {
  status: AirConditionerStatus;
  updateState(newState: Partial<AirConditionerStatus>): void;
  toApiCommand(): Partial<MockDeviceCommandPayload>;
  getPlainState(): AirConditionerStatus;
  toPlainObject(): any;
  toApiStatus: any;
  removeListener(event: string, listener: (...args: any[]) => void): this;
  
  // DeviceState setter methods
  setPower(power: PowerState): void;
  setOperationMode(mode: OperationMode): void;
  setTargetTemperature(temp: number): void;
  setFanSpeed(fanSpeed: FanSpeed): void;
  setSwingMode(swingMode: SwingMode): void;
  setTurboMode(turboMode: PowerState): void;
  setEcoMode(ecoMode: PowerState): void;
  setDisplayMode(displayMode: PowerState): void;
  setBeepMode(beepMode: PowerState): void;
  setSleepMode(sleepMode: SleepModeState): void;
  
  // DeviceState getter properties
  power: PowerState;
  operationMode: OperationMode;
  targetTemperature: number;
  currentTemperature: number;
  outdoorTemperature: number | null;
  fanSpeed: FanSpeed;
  swingMode: SwingMode;
  turboMode: PowerState;
  ecoMode: PowerState;
  displayMode: PowerState;
  beepMode: PowerState;
  sleepMode: SleepModeState;
  lastUpdated: Date;
  
  // DeviceState clone method
  clone(): MockDeviceState;
}

// Mock characteristic creation
export function createMockCharacteristic(): IMockCharacteristic {
  const onMethod = function (this: any, event: 'get' | 'set', handler: any): any {
    if (event === 'get') {
      this.getHandler = handler; 
    } else {
      this.setHandler = handler; 
    }
    return this;
  };
  return {
    UUID: 'mock-char-uuid',
    value: null,
    props: {},
    on: vi.fn(onMethod),
    onSet: vi.fn(function (this: any, handler: any) {
      this.setHandler = handler; return this; 
    }),
    onGet: vi.fn(function (this: any, handler: any) {
      this.getHandler = handler; return this; 
    }),
    updateValue: vi.fn(function (this: any, newValue: CharacteristicValue) {
      this.value = newValue; return this; 
    }),
    setProps: vi.fn().mockReturnThis(),
  };
}

// Mock service creation
export function createMockService(serviceUUID = 'mock-service-uuid', displayName = 'Mock Service'): Service {
  const characteristics = new Map<string, IMockCharacteristic>();
  const getCharacteristic = vi.fn((charIdentifier: any): IMockCharacteristic => {
    const key = charIdentifier?.UUID || String(charIdentifier);
    if (!characteristics.has(key)) {
      const newChar = createMockCharacteristic();
      newChar.UUID = key;
      characteristics.set(key, newChar);
    }
    return characteristics.get(key)!;
  });

  return {
    characteristics,
    UUID: serviceUUID,
    displayName,
    getCharacteristic,
    setCharacteristic: vi.fn(function (this: any, charIdentifier: any, value: CharacteristicValue) {
      const mockChar = getCharacteristic(charIdentifier);
      mockChar.updateValue(value);
      return this;
    }),
    updateCharacteristic: vi.fn(function (this: any, charIdentifier: any, value: any) {
      const mockChar = getCharacteristic(charIdentifier);
      mockChar.updateValue(value);
      return this;
    }),
    addCharacteristic: vi.fn().mockReturnThis(),
    removeCharacteristic: vi.fn(),
    on: vi.fn().mockReturnThis(),
  } as unknown as Service;
}

// Helper to create a mock service constructor
const createMockServiceConstructor = (uuid: string, defaultDisplayName = 'MockService') => {
  const constructor = function(this: any, displayName?: string, subtype?: string) {
    const serviceInstance = createMockService(uuid, displayName || defaultDisplayName);
    if (subtype) {
      serviceInstance.subtype = subtype;
    }
    return serviceInstance;
  };
  constructor.UUID = uuid;
  return vi.fn(constructor);
};

// Interfaces
export interface MockLogger extends Partial<Logging> {
  debug: Mock<(...args: any[]) => any>;
  info: Mock<(...args: any[]) => any>;
  warn: Mock<(...args: any[]) => any>;
  error: Mock<(...args: any[]) => any>;
  log: Mock<(...args: any[]) => any>;
  success: Mock<(...args: any[]) => any>;
}

export interface MockApiActions {
  updateState: Mock<(force?: boolean) => Promise<AirConditionerStatus>>;
  setDeviceOptions: Mock<(options: ApiPartialDeviceOptions) => Promise<void>>;
  setPower: Mock<(state: PowerState) => Promise<void>>;
  setMode: Mock<(mode: OperationMode, targetTemp?: number) => Promise<void>>;
  setFanAndSleep: Mock<(fanSpeed: FanSpeed, sleep: SleepModeState | string) => Promise<void>>;
  setSleepAndTurbo: Mock<(sleep: SleepModeState | string, turbo: PowerState) => Promise<void>>;
  setFanOnly: Mock<(fanSpeed: FanSpeed) => Promise<void>>;
  turnOn: Mock<() => Promise<void>>;
  turnOff: Mock<() => Promise<void>>;
  setAirConditionerState: Mock<() => Promise<void>>;
  setFanSpeed: Mock<() => Promise<void>>;
  setSwingMode: Mock<() => Promise<void>>;
  cleanup: Mock<() => void>;
  api: {
    on: Mock<(...args: any[]) => any>;
    off: Mock<(...args: any[]) => any>;
  };
}

export interface MockDeviceCommandPayload {
  TurnOn?: PowerState | string;
  BaseMode?: OperationMode | string;
  SetTemp?: number;
  WindSpeed?: FanSpeed | string;
  WindDirection_H?: 'on' | 'off';
  WindDirection_V?: 'on' | 'off';
  Opt_super?: PowerState | string;
  Opt_eco?: PowerState | string;
  Opt_display?: PowerState | string;
  Opt_beep?: PowerState | string;
  Opt_sleepMode?: SleepModeState | string;
}

export interface IMockCharacteristic {
  UUID: string;
  value: CharacteristicValue | null;
  props: any;
  on: Mock<(...args: any[]) => any>;
  onSet: Mock<(...args: any[]) => any>;
  onGet: Mock<(...args: any[]) => any>;
  setProps: Mock<(...args: any[]) => any>;
  updateValue: Mock<(...args: any[]) => any>;
  getHandler?: CharacteristicGetCallback;
  setHandler?: CharacteristicSetCallback;
}

export interface MockAPI {
  hap: {
    Service: Record<string, { UUID: string } & any>;
    Characteristic: Record<string, IMockCharacteristic & any>;
    HAPStatus: {
      SUCCESS: number;
      SERVICE_COMMUNICATION_FAILURE: number;
      [key: string]: number;
    };
    HAPStatusError: {
      new (hapStatus: number): Error & { hapStatus: number; status: number; };
    };
    HapStatusError: {
      new (hapStatus: number): Error & { hapStatus: number; status: number; };
    };
    uuid: {
      generate: Mock<(arg: string) => string>;
      isValid: Mock<(arg: string) => boolean>;
    };
    Categories: {
      AIR_CONDITIONER: number;
    };
  };
  registerPlatformAccessories: Mock<(...args: any[]) => any>;
  updatePlatformAccessories: Mock<(...args: any[]) => any>;
  unregisterPlatformAccessories: Mock<(...args: any[]) => any>;
  platformAccessory: Mock<(...args: any[]) => any>;
  on: Mock<(...args: any[]) => any>;
  emit: Mock<(...args: any[]) => any>;
  removeAccessories: Mock<(...args: any[]) => any>;
  api: {
    on: Mock<(...args: any[]) => any>;
    off: Mock<(...args: any[]) => any>;
  };
}

// Mock API creation
export function createMockAPI(customUuid?: string): MockAPI {
  const mockCharacteristicFunc = (uuid: string): IMockCharacteristic => {
    const onMethod = function (this: any, event: 'get' | 'set', handler: any): any {
      if (event === 'get') {
        this.getHandler = handler;
      } else {
        this.setHandler = handler;
      }
      return this;
    };
    return {
      UUID: uuid,
      value: null,
      props: {},
      on: vi.fn(onMethod),
      onSet: vi.fn(function (this: any, handler: any) {
        this.setHandler = handler; return this; 
      }),
      onGet: vi.fn(function (this: any, handler: any) {
        this.getHandler = handler; return this; 
      }),
      updateValue: vi.fn(function (this: any, newValue: CharacteristicValue) {
        this.value = newValue; return this; 
      }),
      setProps: vi.fn().mockReturnThis(),
    };
  };

  return {
    hap: {
      Service: {
        AccessoryInformation: createMockServiceConstructor('0000003E-0000-1000-8000-0026BB765291', 'Accessory Information'),
        Switch: createMockServiceConstructor('00000049-0000-1000-8000-0026BB765291', 'Switch'),
        Outlet: createMockServiceConstructor('00000047-0000-1000-8000-0026BB765291', 'Outlet'),
        Thermostat: createMockServiceConstructor('0000004A-0000-1000-8000-0026BB765291', 'Thermostat'),
        HeaterCooler: createMockServiceConstructor('000000BC-0000-1000-8000-0026BB765291', 'HeaterCooler'),
        Fan: createMockServiceConstructor('00000040-0000-1000-8000-0026BB765291', 'Fan'),
        Fanv2: createMockServiceConstructor('000000B7-0000-1000-8000-0026BB765291', 'Fanv2'),
        Lightbulb: createMockServiceConstructor('00000043-0000-1000-8000-0026BB765291', 'Lightbulb'),
        TemperatureSensor: createMockServiceConstructor('0000008A-0000-1000-8000-0026BB765291', 'Temperature Sensor'),
      },
      Characteristic: {
        Name: mockCharacteristicFunc('00000023-0000-1000-8000-0026BB765291'),
        Manufacturer: mockCharacteristicFunc('00000020-0000-1000-8000-0026BB765291'),
        Model: mockCharacteristicFunc('00000021-0000-1000-8000-0026BB765291'),
        SerialNumber: mockCharacteristicFunc('00000030-0000-1000-8000-0026BB765291'),
        Identify: mockCharacteristicFunc('00000014-0000-1000-8000-0026BB765291'),
        FirmwareRevision: mockCharacteristicFunc('00000052-0000-1000-8000-0026BB765291'),
        On: mockCharacteristicFunc('00000025-0000-1000-8000-0026BB765291'),
        CurrentHeatingCoolingState: mockCharacteristicFunc('0000000F-0000-1000-8000-0026BB765291'),
        TargetHeatingCoolingState: {
          ...mockCharacteristicFunc('00000033-0000-1000-8000-0026BB765291'),
          OFF: 0, HEAT: 1, COOL: 2, AUTO: 3,
        },
        CurrentTemperature: mockCharacteristicFunc('00000011-0000-1000-8000-0026BB765291'),
        TargetTemperature: mockCharacteristicFunc('00000035-0000-1000-8000-0026BB765291'),
        TemperatureDisplayUnits: {
          ...mockCharacteristicFunc('00000036-0000-1000-8000-0026BB765291'),
          CELSIUS: 0, FAHRENHEIT: 1,
        },
        Active: {
          ...mockCharacteristicFunc('000000B0-0000-1000-8000-0026BB765291'),
          INACTIVE: 0,
          ACTIVE: 1,
        },
        CurrentHeaterCoolerState: mockCharacteristicFunc('000000B1-0000-1000-8000-0026BB765291'),
        TargetHeaterCoolerState: {
          ...mockCharacteristicFunc('000000B2-0000-1000-8000-0026BB765291'),
          OFF: 0,
          HEAT: 1,
          COOL: 2,
          AUTO: 3,
        },
        SwingMode: {
          ...mockCharacteristicFunc('000000B6-0000-1000-8000-0026BB765291'),
          SWING_DISABLED: 0,
          SWING_ENABLED: 1,
        },
        RotationSpeed: mockCharacteristicFunc('00000029-0000-1000-8000-0026BB765291'),
        CoolingThresholdTemperature: mockCharacteristicFunc('0000000D-0000-1000-8000-0026BB765291'),
        HeatingThresholdTemperature: mockCharacteristicFunc('00000012-0000-1000-8000-0026BB765291'),
      },
      HAPStatus: {
        SUCCESS: 0,
        SERVICE_COMMUNICATION_FAILURE: -70402,
      },
      HAPStatusError: vi.fn().mockImplementation((hapStatus: number) => {
        const error = new Error(`HAPStatusError: ${hapStatus}`);
        error.name = 'HAPStatusError';
        (error as any).hapStatus = hapStatus;
        (error as any).status = hapStatus;
        return error;
      }),
      HapStatusError: vi.fn().mockImplementation((hapStatus: number) => {
        const error = new Error(`HAPStatusError: ${hapStatus}`);
        error.name = 'HAPStatusError';
        (error as any).hapStatus = hapStatus;
        (error as any).status = hapStatus;
        return error;
      }),
      uuid: {
        generate: vi.fn().mockImplementation((val: string) => customUuid || `${val}-uuid`),
        isValid: vi.fn().mockReturnValue(true),
      },
      Categories: {
        AIR_CONDITIONER: 21,
      },
    },
    platformAccessory: vi.fn().mockImplementation((displayName, uuid) => ({
      displayName,
      UUID: uuid,
      addService: vi.fn(),
      getService: vi.fn(),
    })),
    registerPlatformAccessories: vi.fn(),
    updatePlatformAccessories: vi.fn(),
    unregisterPlatformAccessories: vi.fn(),
    on: vi.fn(),
    emit: vi.fn(),
    removeAccessories: vi.fn(),
    api: { on: vi.fn(), off: vi.fn() },
  } as MockAPI;
}

// Shared mock API and constants
export const sharedMockAPI = createMockAPI();
export const hapConstants = sharedMockAPI.hap;

// Default device options and initial status
export const defaultDeviceOptions: DeviceOptions & { uiHoldSeconds: number } = {
  id: 'test-device-id',
  name: 'Test AC',
  power: PowerState.Off,
  mode: OperationMode.Auto,
  temp: 22,
  fanSpeed: FanSpeed.Auto,
  swingMode: SwingMode.Off,
  sleep: SleepModeState.Off,
  turbo: PowerState.Off,
  display: PowerState.On,
  eco: PowerState.Off,
  beep: PowerState.On,
  uiHoldSeconds: 5, // Add a default value for tests
};

export const initialStatusCelsius: Partial<AirConditionerStatus> = {
  is_on: PowerState.Off,
  operation_mode: OperationMode.Cool,
  target_temp: 22,
  current_temp: 24,
  fan_mode: FanSpeed.Auto,
  swing_mode: SwingMode.Off,
  opt_sleepMode: SleepModeState.Off,
  opt_turbo: PowerState.Off,
  opt_eco: PowerState.Off,
  opt_display: PowerState.On,
  opt_beep: PowerState.On,
  outdoor_temp: 28,
};

// Mock platform accessory creation
export function generateTestPlatformAccessory(
  displayName: string = defaultDeviceOptions.name,
  uuid: string = sharedMockAPI.hap.uuid.generate(defaultDeviceOptions.id),
  deviceConfig: TfiacDeviceConfig = { ...defaultDeviceOptions, ip: '1.2.3.4' },
  mainServiceInput?: Service,
): PlatformAccessory {
  const accessoryInformationService = createMockService(
    hapConstants.Service.AccessoryInformation.UUID, 'Accessory Information');
  const mainService = mainServiceInput || createMockService(hapConstants.Service.Switch.UUID, displayName);

  accessoryInformationService.getCharacteristic(hapConstants.Characteristic.Manufacturer).updateValue('Test Manufacturer');
  accessoryInformationService.getCharacteristic(hapConstants.Characteristic.Model).updateValue('Test Model');
  accessoryInformationService.getCharacteristic(hapConstants.Characteristic.SerialNumber).updateValue(defaultDeviceOptions.id);
  accessoryInformationService.getCharacteristic(hapConstants.Characteristic.Name).updateValue(displayName);

  const services: Service[] = [accessoryInformationService, mainService];

  const mockAccessory = {
    context: { deviceConfig, deviceOptions: { ...defaultDeviceOptions, ...deviceConfig } },
    displayName,
    UUID: uuid,
    category: Categories.AIR_CONDITIONER,
    services,
    getService: vi.fn((identifier: string | WithUUID<typeof Service>) => {
      const searchUUID = (typeof identifier !== 'string' && (identifier as any).UUID) ? (identifier as any).UUID : undefined;
      const searchNameOrUUIDString = (typeof identifier === 'string') ? identifier : undefined;

      for (const s of services) {
        if (searchUUID && s.UUID === searchUUID) {
          return s;
        }
        if (searchNameOrUUIDString && (s.displayName === searchNameOrUUIDString || s.UUID === searchNameOrUUIDString)) {
          return s;
        }
      }
      return undefined;
    }),
    addService: vi.fn((serviceToAdd: Service | (new (...args: any[]) => Service), newServiceDisplayName?: string, subtype?: string, ...otherArgs: any[]) => {
      let newServiceInstance: Service;
      if (typeof serviceToAdd === 'function') {
        const ServiceConstructor = serviceToAdd as any;
        newServiceInstance = ServiceConstructor(newServiceDisplayName, subtype);
      } else {
        newServiceInstance = serviceToAdd;
        if (newServiceDisplayName) {
          newServiceInstance.displayName = newServiceDisplayName;
        }
        if (subtype && newServiceInstance.subtype === undefined) {
          newServiceInstance.subtype = subtype;
        }
      }
      const existingService = services.find(s =>
        s.UUID === newServiceInstance.UUID &&
        s.subtype === newServiceInstance.subtype,
      );
      if (existingService) {
        if (newServiceDisplayName && existingService.displayName !== newServiceDisplayName) {
          existingService.displayName = newServiceDisplayName;
        }
        return existingService;
      } else {
        services.push(newServiceInstance);
        return newServiceInstance;
      }
    }),
    removeService: vi.fn((serviceToRemove: Service) => {
      const index = services.findIndex(s => s.UUID === serviceToRemove.UUID && s.displayName === serviceToRemove.displayName);
      if (index !== -1) {
        services.splice(index, 1);
      }
    }),
    getServiceById: vi.fn((serviceUUID: string, subtype?: string) => {
      return services.find(s => s.UUID === serviceUUID && (subtype ? s.subtype === subtype : true));
    }),
    on: vi.fn().mockReturnThis(),
    emit: vi.fn().mockReturnValue(true),
    updateReachability: vi.fn(),
  } as unknown as PlatformAccessory;

  return mockAccessory;
}

// Generate mock platform accessory
export function createMockPlatformAccessory(
  displayName: string = defaultDeviceOptions.name,
  uuid: string = sharedMockAPI.hap.uuid.generate(defaultDeviceOptions.id),
  deviceConfig: TfiacDeviceConfig = { ...defaultDeviceOptions, ip: '1.2.3.4' },
  mainServiceInput?: Service,
): PlatformAccessory {
  return generateTestPlatformAccessory(displayName, uuid, deviceConfig, mainServiceInput);
}

// Other creator functions
export function createMockLogger(): MockLogger {
  return {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn(), success: vi.fn(),
  };
}

export function createMockApiActions(initialStatus: Partial<AirConditionerStatus> = {}): MockApiActions & { api: any } {
  const actions = {
    updateState: vi.fn().mockResolvedValue(initialStatus),
    setDeviceOptions: vi.fn().mockResolvedValue(undefined),
    setPower: vi.fn().mockResolvedValue(undefined),
    setMode: vi.fn().mockResolvedValue(undefined),
    setFanAndSleep: vi.fn().mockResolvedValue(undefined),
    setSleepAndTurbo: vi.fn().mockResolvedValue(undefined),
    setFanOnly: vi.fn().mockResolvedValue(undefined),
    // Add methods expected by core tests
    turnOn: vi.fn().mockResolvedValue(undefined),
    turnOff: vi.fn().mockResolvedValue(undefined),
    setAirConditionerState: vi.fn().mockResolvedValue(undefined),
    setFanSpeed: vi.fn().mockResolvedValue(undefined),
    setSwingMode: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn(),
    api: { on: vi.fn(), off: vi.fn() },
  };
  return actions as MockApiActions & { api: any };
}

export function createMockDeviceState(
  options: DeviceOptions,
  initialOverrides?: Partial<AirConditionerStatus>,
): MockDeviceState {
  const emitter = new EventEmitter() as MockDeviceState;
  const defaultStatus: AirConditionerStatus = {
    is_on: PowerState.Off, operation_mode: OperationMode.Auto, target_temp: 20, current_temp: 22,
    fan_mode: FanSpeed.Auto, swing_mode: SwingMode.Off, opt_eco: PowerState.Off, opt_turbo: PowerState.Off,
    opt_sleepMode: SleepModeState.Off, opt_sleep: PowerState.Off, opt_display: PowerState.On,
    opt_beep: PowerState.On, outdoor_temp: 25, ...initialOverrides,
  };
  emitter.status = { ...defaultStatus };
  emitter.updateState = (newState: Partial<AirConditionerStatus>) => {
    emitter.status = { ...emitter.status, ...newState };
    emitter.emit('statusChanged', { ...emitter.status });
  };
  
  // Add DeviceState setter methods as mocks
  (emitter as any).setPower = vi.fn((power: PowerState) => {
    emitter.status.is_on = power;
  });
  (emitter as any).setOperationMode = vi.fn((mode: OperationMode) => {
    emitter.status.operation_mode = mode;
  });
  (emitter as any).setTargetTemperature = vi.fn((temp: number) => {
    emitter.status.target_temp = temp;
  });
  (emitter as any).setFanSpeed = vi.fn((fanSpeed: FanSpeed) => {
    emitter.status.fan_mode = fanSpeed;
  });
  (emitter as any).setSwingMode = vi.fn((swingMode: SwingMode) => {
    emitter.status.swing_mode = swingMode;
  });
  (emitter as any).setTurboMode = vi.fn((turboMode: PowerState) => {
    emitter.status.opt_turbo = turboMode;
  });
  (emitter as any).setEcoMode = vi.fn((ecoMode: PowerState) => {
    emitter.status.opt_eco = ecoMode;
  });
  (emitter as any).setDisplayMode = vi.fn((displayMode: PowerState) => {
    emitter.status.opt_display = displayMode;
  });
  (emitter as any).setBeepMode = vi.fn((beepMode: PowerState) => {
    emitter.status.opt_beep = beepMode;
  });
  (emitter as any).setSleepMode = vi.fn((sleepMode: SleepModeState) => {
    emitter.status.opt_sleepMode = sleepMode;
    emitter.status.opt_sleep = sleepMode === SleepModeState.On ? PowerState.On : PowerState.Off;
  });
  
  // Add getter properties (these need to be both readable and writable for tests)
  Object.defineProperty(emitter, 'power', {
    get: () => emitter.status.is_on,
    set: (value: PowerState) => {
      emitter.status.is_on = value;
    },
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(emitter, 'operationMode', {
    get: () => emitter.status.operation_mode,
    set: (value: OperationMode) => {
      emitter.status.operation_mode = value;
    },
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(emitter, 'targetTemperature', {
    get: () => emitter.status.target_temp,
    set: (value: number) => {
      emitter.status.target_temp = value;
    },
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(emitter, 'currentTemperature', {
    get: () => emitter.status.current_temp,
    set: (value: number) => {
      emitter.status.current_temp = value;
    },
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(emitter, 'outdoorTemperature', {
    get: () => emitter.status.outdoor_temp,
    set: (value: number | undefined) => {
      emitter.status.outdoor_temp = value;
    },
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(emitter, 'fanSpeed', {
    get: () => emitter.status.fan_mode,
    set: (value: FanSpeed) => {
      emitter.status.fan_mode = value;
    },
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(emitter, 'swingMode', {
    get: () => emitter.status.swing_mode,
    set: (value: SwingMode) => {
      emitter.status.swing_mode = value;
    },
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(emitter, 'turboMode', {
    get: () => emitter.status.opt_turbo,
    set: (value: PowerState) => {
      emitter.status.opt_turbo = value;
    },
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(emitter, 'ecoMode', {
    get: () => emitter.status.opt_eco,
    set: (value: PowerState) => {
      emitter.status.opt_eco = value;
    },
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(emitter, 'displayMode', {
    get: () => emitter.status.opt_display,
    set: (value: PowerState) => {
      emitter.status.opt_display = value;
    },
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(emitter, 'beepMode', {
    get: () => emitter.status.opt_beep,
    set: (value: PowerState) => {
      emitter.status.opt_beep = value;
    },
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(emitter, 'sleepMode', {
    get: () => emitter.status.opt_sleepMode,
    set: (value: SleepModeState) => { 
      emitter.status.opt_sleepMode = value; 
      emitter.status.opt_sleep = value === SleepModeState.On ? PowerState.On : PowerState.Off;
    },
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(emitter, 'lastUpdated', {
    get: () => new Date(),
    set: (value: Date) => {
      /* ignore setter for tests */
    },
    enumerable: true,
    configurable: true,
  });
  
  // Add clone method that returns a new mock device state with the same status
  (emitter as any).clone = vi.fn(() => {
    return createMockDeviceState(options, emitter.status);
  });
  
  emitter.toApiCommand = (): Partial<MockDeviceCommandPayload> => {
    const command: Partial<MockDeviceCommandPayload> = {};
    if (emitter.status.is_on !== undefined) {
      command.TurnOn = emitter.status.is_on; 
    }
    if (emitter.status.operation_mode !== undefined) {
      command.BaseMode = emitter.status.operation_mode; 
    }
    if (emitter.status.target_temp !== undefined) {
      command.SetTemp = emitter.status.target_temp; 
    }
    if (emitter.status.fan_mode !== undefined) {
      command.WindSpeed = emitter.status.fan_mode; 
    }
    if (emitter.status.swing_mode !== undefined) {
      switch (emitter.status.swing_mode) {
      case SwingMode.Off: command.WindDirection_H = 'off'; command.WindDirection_V = 'off'; break;
      case SwingMode.Vertical: command.WindDirection_H = 'off'; command.WindDirection_V = 'on'; break;
      case SwingMode.Horizontal: command.WindDirection_H = 'on'; command.WindDirection_V = 'off'; break;
      case SwingMode.Both: command.WindDirection_H = 'on'; command.WindDirection_V = 'on'; break;
      }
    }
    if (emitter.status.opt_eco !== undefined) {
      command.Opt_eco = emitter.status.opt_eco; 
    }
    if (emitter.status.opt_turbo !== undefined) {
      command.Opt_super = emitter.status.opt_turbo; 
    }
    if (emitter.status.opt_sleepMode !== undefined) {
      command.Opt_sleepMode = emitter.status.opt_sleepMode; 
    }
    if (emitter.status.opt_display !== undefined) {
      command.Opt_display = emitter.status.opt_display; 
    }
    if (emitter.status.opt_beep !== undefined) {
      command.Opt_beep = emitter.status.opt_beep; 
    }
    return command;
  };
  emitter.getPlainState = (): AirConditionerStatus => ({ ...emitter.status });
  emitter.toPlainObject = (): any => ({
    power: emitter.status.is_on,
    operationMode: emitter.status.operation_mode,
    targetTemperature: emitter.status.target_temp,
    currentTemperature: emitter.status.current_temp,
    outdoorTemperature: emitter.status.outdoor_temp,
    fanSpeed: emitter.status.fan_mode,
    swingMode: emitter.status.swing_mode,
    turboMode: emitter.status.opt_turbo,
    ecoMode: emitter.status.opt_eco,
    displayMode: emitter.status.opt_display,
    beepMode: emitter.status.opt_beep,
    sleepMode: emitter.status.opt_sleepMode,
    lastUpdated: new Date(),
  });
  emitter.toApiStatus = vi.fn(() => ({ ...emitter.status }));
  emitter.removeListener = vi.fn((event: string, listener: (...args: any[]) => void) => {
    EventEmitter.prototype.removeListener.call(emitter, event, listener);
    return emitter;
  });
  return emitter;
}

export function createMockCacheManager(
  initialStatuses: Record<string, Partial<AirConditionerStatus>> = {},
): MockCacheManagerType {
  const emitter = new EventEmitter() as MockCacheManagerType;
  const deviceStates: Record<string, MockDeviceState> = {};
  const cachedStatuses: Record<string, Partial<AirConditionerStatus>> = { ...initialStatuses };

  const ensureDeviceState = (deviceId: string, deviceOpts?: DeviceOptions) => {
    if (!deviceStates[deviceId] && deviceOpts) {
      deviceStates[deviceId] = createMockDeviceState(deviceOpts, cachedStatuses[deviceId] || {});
    }
    return deviceStates[deviceId];
  };

  emitter.getDeviceState = vi.fn((deviceId: string) => {
    if (!deviceStates[deviceId] && defaultDeviceOptions.id === deviceId) {
      ensureDeviceState(deviceId, defaultDeviceOptions);
    }
    return deviceStates[deviceId];
  });
  emitter.getCachedStatus = vi.fn(async (deviceId: string) => cachedStatuses[deviceId]);
  emitter.updateCache = vi.fn(async (deviceId: string, newStatus: Partial<AirConditionerStatus>) => {
    cachedStatuses[deviceId] = { ...(cachedStatuses[deviceId] || {}), ...newStatus };
    const deviceState = deviceStates[deviceId];
    if (deviceState) {
      deviceState.updateState(newStatus); 
    }
    emitter.emit('cacheUpdated', deviceId, cachedStatuses[deviceId]!);
  });

  if (!initialStatuses[defaultDeviceOptions.id]) {
    cachedStatuses[defaultDeviceOptions.id] = { ...initialStatusCelsius };
    ensureDeviceState(defaultDeviceOptions.id, defaultDeviceOptions);
  }
  return emitter;
}

// Test platform setup
export function setupTestPlatform(
  config: Partial<PlatformConfig> = {},
  customLogger?: MockLogger,
  customAPI?: MockAPI,
): TfiacPlatform {
  const logger = customLogger || createMockLogger();
  const api = customAPI || sharedMockAPI;
  const defaultConfig = {
    name: PLATFORM_NAME, platform: PLATFORM_NAME,
    devices: [{ name: 'Test AC', ip: '192.168.1.99', port: 7777, id: 'default-test-id' }],
    ...config,
  };
  return new TfiacPlatform(
    logger as unknown as Logging,
    defaultConfig as PlatformConfig,
    api as unknown as API,
  );
}

export const mockPlatform = setupTestPlatform();

// Helper function to ensure platform and deviceConfig have uiHoldSeconds for tests
export function ensureUiHoldConfig(platform: any, deviceConfig: any = {}): void {
  // Add uiHoldSeconds to platform config if missing
  if (!platform.config) {
    platform.config = {};
  }
  if (platform.config.uiHoldSeconds === undefined) {
    platform.config.uiHoldSeconds = 5; // Use smaller value for tests
  }

  // Add uiHoldSeconds to device config if missing
  if (deviceConfig && !deviceConfig.uiHoldSeconds) {
    deviceConfig.uiHoldSeconds = 5; // Use smaller value for tests
  }
}

/**
 * Alias setupTestPlatform as createMockPlatform for accessory tests.
 * Ensures the platform has UI hold seconds configuration.
 */
export function createMockPlatform(): TfiacPlatform {
  const platform = setupTestPlatform();
  // Use the helper function to ensure UI hold configuration
  ensureUiHoldConfig(platform);
  return platform;
}

export function createMockPlatformConfig(
  config: Partial<PlatformConfig> & { devices: TfiacDeviceConfig[] },
): PlatformConfig {
  return {
    name: PLATFORM_NAME, platform: PLATFORM_NAME, enableDiscovery: true, ...config,
  } as PlatformConfig;
}

// Define helper temperature conversion functions before using them
export function toFahrenheit(celsius: number): number {
  return (celsius * 9) / 5 + 32;
}
export function toCelsius(fahrenheit: number): number {
  return ((fahrenheit - 32) * 5) / 9;
}

export const initialStatusFahrenheit: Partial<AirConditionerStatus> = {
  is_on: PowerState.Off,
  operation_mode: OperationMode.Cool,
  target_temp: toFahrenheit(22), // 71.6°F
  current_temp: toFahrenheit(24), // 75.2°F
  fan_mode: FanSpeed.Auto,
  swing_mode: SwingMode.Off,
  opt_sleepMode: SleepModeState.Off, 
  opt_turbo: PowerState.Off,
  opt_eco: PowerState.Off,
  opt_display: PowerState.On,
  opt_beep: PowerState.On,
  outdoor_temp: toFahrenheit(28), // 82.4°F
};

// Define hapIdentifiers with all necessary characteristic identifiers used in tests
export const hapIdentifiers = {
  Service: {
    HeaterCooler: 'HeaterCooler',
    Thermostat: 'Thermostat',
    AccessoryInformation: 'AccessoryInformation',
    Switch: 'Switch',
    Fan: 'Fan',
    TemperatureSensor: 'TemperatureSensor',
  },
  Characteristic: {
    CurrentTemperature: 'CurrentTemperature',
    TargetTemperature: 'TargetTemperature',
    TemperatureDisplayUnits: 'TemperatureDisplayUnits',
    Active: 'Active',
    CurrentHeaterCoolerState: 'CurrentHeaterCoolerState',
    TargetHeaterCoolerState: 'TargetHeaterCoolerState',
    SwingMode: 'SwingMode',
    RotationSpeed: 'RotationSpeed',
    CoolingThresholdTemperature: 'CoolingThresholdTemperature', 
    HeatingThresholdTemperature: 'HeatingThresholdTemperature',
    On: 'On',
    Name: 'Name',
    Manufacturer: 'Manufacturer',
    Model: 'Model',
    SerialNumber: 'SerialNumber',
  },
};

// Helper to get a characteristic handler by identifier
export function getHandlerByIdentifier(
  mockService: any,
  characteristicIdentifier: string,
  handlerType: 'get' | 'set',
): CharacteristicGetCallback | CharacteristicSetCallback | undefined {
  // If the service has an accessory reference, use it to get the handler directly
  if (mockService.accessory) {
    const accessory = mockService.accessory;
    const handlerName = `handle${characteristicIdentifier}${handlerType.charAt(0).toUpperCase() + handlerType.slice(1)}`;
    
    // Return the handler function bound to the accessory
    if (accessory[handlerName] && typeof accessory[handlerName] === 'function') {
      return accessory[handlerName].bind(accessory);
    }
    
    // For threshold temperature, both cooling and heating share the same handler
    if (characteristicIdentifier === 'CoolingThresholdTemperature' || characteristicIdentifier === 'HeatingThresholdTemperature') {
      const thresholdHandler = `handleThresholdTemperature${handlerType.charAt(0).toUpperCase() + handlerType.slice(1)}`;
      if (accessory[thresholdHandler] && typeof accessory[thresholdHandler] === 'function') {
        return accessory[thresholdHandler].bind(accessory);
      }
    }
  }
  
  // Fallback to the old way of getting handlers
  const characteristic = mockService.getCharacteristic(characteristicIdentifier);
  return handlerType === 'get' ? characteristic?.getHandler : characteristic?.setHandler;
}

console.log('[testUtils.ts] END LOADING. Functions like generateTestPlatformAccessory and createMockPlatform should be defined and exported.');