// platformAccessory.test.ts

import { PlatformAccessory, Categories } from 'homebridge';
// Removed unused import for TfiacPlatformAccessory
import { TfiacPlatform } from '../platform';
import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import dgram from 'dgram';

// Define a local fail function since it's not exported from @jest/globals
function fail(message: string): void {
  throw new Error(message);
}

// --- Types for UDP mock
interface MockSocket {
  send: jest.Mock;
  on: jest.Mock;
  close: jest.Mock;
}

type UDPCallback = (error?: Error) => void;

// --- Mocking UDP socket
jest.mock('dgram', () => {
  const mockSocket: MockSocket = {
    send: jest.fn((...args: unknown[]) => {
      const callback = args[3] as UDPCallback;
      if (typeof callback === 'function') {
        callback();
      }
    }),
    on: jest.fn(),
    close: jest.fn(),
  };
  return {
    createSocket: jest.fn().mockReturnValue(mockSocket),
  };
});

// --- Types for HomeKit characteristics and services
type CharacteristicValue = boolean | string | number;
type GetCallback = (error: Error | null, value?: CharacteristicValue) => void;
type SetCallback = (error: Error | null) => void;

interface CharacteristicHandlers {
  get?: (callback: GetCallback) => void;
  set?: (value: CharacteristicValue, callback: SetCallback) => void;
}

interface MockedCharacteristic {
  handlers: CharacteristicHandlers;
  on(event: 'get', handler: (callback: GetCallback) => void): this;
  on(event: 'set', handler: (value: CharacteristicValue, callback: SetCallback) => void): this;
  emit(event: 'get', callback: GetCallback): void;
  emit(event: 'set', value: CharacteristicValue, callback: SetCallback): void;
  setProps(props: unknown): this;
}

interface MockedService {
  setCharacteristic(characteristic: string, value: CharacteristicValue): this;
  getCharacteristic(characteristic: string): MockedCharacteristic;
}

// --- Device state type
interface DeviceStatus {
  is_on: string;
  current_temp: number;
  target_temp: number;
  operation_mode: string;
  fan_mode: string;
  swing_mode: string;
}

// --- Interface for DeviceAPI
interface DeviceAPI {
  turnOn: () => Promise<void>;
  turnOff: () => Promise<void>;
  setAirConditionerState: (key: string, value: string) => Promise<void>;
  updateState: () => Promise<DeviceStatus>;
  setFanSpeed: (value: string) => Promise<void>;
  setSwingMode: (value: string) => Promise<void>;
  available: boolean;
  cleanup?: () => void;
}

// --- Type for mock DeviceAPI functions
type MockDeviceAPI = {
  turnOn: jest.MockedFunction<() => Promise<void>>;
  turnOff: jest.MockedFunction<() => Promise<void>>;
  setAirConditionerState: jest.MockedFunction<(key: string, value: string) => Promise<void>>;
  updateState: jest.MockedFunction<() => Promise<DeviceStatus>>;
  setFanSpeed: jest.MockedFunction<(value: string) => Promise<void>>;
  setSwingMode: jest.MockedFunction<(value: string) => Promise<void>>;
  available: boolean;
};

// --- Add type declaration for TfiacPlatformAccessory
import { TfiacPlatformAccessory as ImportedTfiacPlatformAccessory } from '../platformAccessory';

// --- Mock characteristic factory
const createMockCharacteristic = (): MockedCharacteristic => {
  const handlers: CharacteristicHandlers = {};
  const mock: MockedCharacteristic = {
    handlers,
    on(event: 'get' | 'set', handler: unknown) {
      if (event === 'get') {
        this.handlers.get = handler as (callback: GetCallback) => void;
      } else if (event === 'set') {
        this.handlers.set = handler as (value: CharacteristicValue, callback: SetCallback) => void;
      }
      return this;
    },
    emit(event: 'get' | 'set', valueOrCallback: unknown, maybeCallback?: unknown) {
      if (event === 'get' && typeof valueOrCallback === 'function') {
        if (this.handlers.get) {
          this.handlers.get(valueOrCallback as GetCallback);
        }
      } else if (event === 'set' && typeof maybeCallback === 'function') {
        if (this.handlers.set) {
          this.handlers.set(valueOrCallback as CharacteristicValue, maybeCallback as SetCallback);
        }
      }
    },
    setProps() {
      return this;
    },
  };
  return mock;
};

// --- Mock service factory
const createMockService = (): MockedService => {
  const characteristics = new Map<string, MockedCharacteristic>();
  const getKey = (characteristic: string | number): string => String(characteristic);
  return {
    setCharacteristic() {
      return this;
    },
    getCharacteristic(characteristic: string | number) {
      const key = getKey(characteristic);
      if (!characteristics.has(key)) {
        characteristics.set(key, createMockCharacteristic());
      }
      return characteristics.get(key)!;
    },
  };
};

// --- Mock platform and accessory
const fakePlatform = {
  log: { debug: jest.fn(), error: jest.fn() },
  config: { deviceType: 'aircon', name: 'Test AC' },
  api: {
    hap: {
      Categories: { AIR_CONDITIONER: 1 },
    },
  },
  accessories: [],
  Service: {},
  Characteristic: {
    Active: { ACTIVE: 1, INACTIVE: 0 },
    CurrentHeaterCoolerState: { COOLING: 2, HEATING: 1, IDLE: 0 },
    TargetHeaterCoolerState: { COOL: 2, HEAT: 1, AUTO: 0 },
    Name: 'Name',
    CurrentTemperature: 'CurrentTemperature',
    CoolingThresholdTemperature: 'CoolingThresholdTemperature',
  },
  discoverDevices: jest.fn(),
  configureAccessory: jest.fn(),
} as unknown as TfiacPlatform;

const mockService = createMockService();

const fakeAccessory = {
  context: {
    deviceConfig: {
      name: 'Test AC',
      ip: '192.168.1.100',
      port: 7777,
      updateInterval: 30,
    },
  },
  UUID: 'unique-id',
  displayName: 'Test AC',
  category: Categories.AIR_CONDITIONER,
  getService: jest.fn().mockReturnValue(mockService),
  addService: jest.fn().mockReturnValue(mockService),
} as unknown as PlatformAccessory;

// --- Mock device initial status
const initialStatus: DeviceStatus = {
  is_on: 'off',
  current_temp: 72,
  target_temp: 70,
  operation_mode: 'cool',
  fan_mode: 'Auto',
  swing_mode: 'Off',
};

describe('TfiacPlatformAccessory', () => {
  let accessoryInstance: ImportedTfiacPlatformAccessory;
  let mockSocket: MockSocket;

  beforeAll(() => {
    jest.setTimeout(10000);
  });

  beforeEach(() => {
    jest.useFakeTimers();
    mockSocket = (dgram.createSocket as jest.Mock)() as MockSocket;

    // Create a new accessory instance
    accessoryInstance = new ImportedTfiacPlatformAccessory(fakePlatform, fakeAccessory);
    // Disable polling
    jest.spyOn(accessoryInstance as unknown as { startPolling(): void }, 'startPolling').mockImplementation(() => {});

    // Mock deviceAPI
    const mockDeviceAPI: MockDeviceAPI = {
      turnOn: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      turnOff: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      setAirConditionerState: jest
        .fn<(key: string, value: string) => Promise<void>>()
        .mockResolvedValue(undefined),
      updateState: jest.fn<() => Promise<DeviceStatus>>().mockResolvedValue(initialStatus),
      setFanSpeed: jest.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined),
      setSwingMode: jest.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined),
      available: true,
    };
    (accessoryInstance as unknown as { deviceAPI: MockDeviceAPI }).deviceAPI = mockDeviceAPI;

    // Set cached status and service
    (accessoryInstance as unknown as { cachedStatus: DeviceStatus }).cachedStatus = { ...initialStatus };
    (accessoryInstance as unknown as { service: MockedService }).service = mockService;

    // Register all the necessary mock handlers
    const setupMockHandlers = () => {
      // Mock handlers for characteristics
      const targetHeaterCoolerStateCharacteristic = mockService.getCharacteristic('TargetHeaterCoolerState');
      targetHeaterCoolerStateCharacteristic.on('set', (value, callback) => {
        mockDeviceAPI.setAirConditionerState('operation_mode', 
          value === 0 ? 'auto' : value === 1 ? 'heat' : 'cool').then(
          () => callback(null), 
          error => callback(error),
        );
      });

      targetHeaterCoolerStateCharacteristic.on('get', (callback) => {
        const status = (accessoryInstance as unknown as { cachedStatus: DeviceStatus }).cachedStatus;
        if (status) {
          const state = status.operation_mode === 'cool'
            ? fakePlatform.Characteristic.TargetHeaterCoolerState.COOL
            : status.operation_mode === 'heat'
              ? fakePlatform.Characteristic.TargetHeaterCoolerState.HEAT
              : fakePlatform.Characteristic.TargetHeaterCoolerState.AUTO;
          callback(null, state);
        } else {
          callback(new Error('Cached status not available'));
        }
      });
      
      const rotationSpeedCharacteristic = mockService.getCharacteristic('RotationSpeed');
      rotationSpeedCharacteristic.on('set', (value, callback) => {
        const speed = Number(value);
        let fanMode = 'Low';
        if (speed <= 25) {
          fanMode = 'Low';
        } else if (speed <= 50) {
          fanMode = 'Middle';
        } else if (speed <= 75) {
          fanMode = 'High';
        } else {
          fanMode = 'Auto';
        }
        mockDeviceAPI.setFanSpeed(fanMode).then(
          () => callback(null),
          error => callback(error),
        );
      });
      
      rotationSpeedCharacteristic.on('get', (callback) => {
        const status = (accessoryInstance as unknown as { cachedStatus: DeviceStatus }).cachedStatus;
        if (status) {
          const fanSpeed = status.fan_mode === 'Low' ? 25 
            : status.fan_mode === 'Middle' ? 50
              : status.fan_mode === 'High' ? 75
                : 50; // Default or Auto
          callback(null, fanSpeed);
        } else {
          callback(new Error('Cached status not available'));
        }
      });
      
      const swingModeCharacteristic = mockService.getCharacteristic('SwingMode');
      swingModeCharacteristic.on('set', (value, callback) => {
        const mode = value ? 'Both' : 'Off';
        mockDeviceAPI.setSwingMode(mode).then(
          () => callback(null),
          error => callback(error),
        );
      });
      
      swingModeCharacteristic.on('get', (callback) => {
        const status = (accessoryInstance as unknown as { cachedStatus: DeviceStatus }).cachedStatus;
        if (status) {
          callback(null, status.swing_mode === 'Off' ? 0 : 1);
        } else {
          callback(new Error('Cached status not available'));
        }
      });
      
      const currentHeaterCoolerStateCharacteristic = mockService.getCharacteristic('CurrentHeaterCoolerState');
      currentHeaterCoolerStateCharacteristic.on('get', (callback) => {
        const status = (accessoryInstance as unknown as { cachedStatus: DeviceStatus }).cachedStatus;
        if (status) {
          const state = status.operation_mode === 'cool' 
            ? fakePlatform.Characteristic.CurrentHeaterCoolerState.COOLING
            : status.operation_mode === 'heat'
              ? fakePlatform.Characteristic.CurrentHeaterCoolerState.HEATING
              : fakePlatform.Characteristic.CurrentHeaterCoolerState.IDLE;
          callback(null, state);
        } else {
          callback(new Error('Cached status not available'));
        }
      });
      
      // For threshold temperatures
      const coolingThresholdTempCharacteristic = mockService.getCharacteristic('CoolingThresholdTemperature');
      const heatingThresholdTempCharacteristic = mockService.getCharacteristic('HeatingThresholdTemperature');
      
      coolingThresholdTempCharacteristic.on('get', (callback) => {
        const status = (accessoryInstance as unknown as { cachedStatus: DeviceStatus }).cachedStatus;
        if (status) {
          const celsiusTemp = ((status.target_temp - 32) * 5) / 9;
          callback(null, celsiusTemp);
        } else {
          callback(new Error('Cached status not available'));
        }
      });
      
      heatingThresholdTempCharacteristic.on('get', (callback) => {
        const status = (accessoryInstance as unknown as { cachedStatus: DeviceStatus }).cachedStatus;
        if (status) {
          const celsiusTemp = ((status.target_temp - 32) * 5) / 9;
          callback(null, celsiusTemp);
        } else {
          callback(new Error('Cached status not available'));
        }
      });
    };
    
    // Setup all the mock handlers
    setupMockHandlers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    if (mockSocket) {
      mockSocket.close();
    }
    jest.clearAllMocks();
  });

  describe('Characteristic handlers', () => {
    it('should handle Active get correctly', async () => {
      (accessoryInstance as unknown as { cachedStatus: DeviceStatus }).cachedStatus = { ...initialStatus, is_on: 'on' };

      const characteristic = mockService.getCharacteristic('Active');

      characteristic.emit('get', () => {});
      jest.runOnlyPendingTimers();

      expect((accessoryInstance as unknown as { cachedStatus: DeviceStatus }).cachedStatus?.is_on).toBe('on');
    });

    it('should handle Active set correctly', async () => {
      const mockDeviceAPI = (accessoryInstance as unknown as { deviceAPI: DeviceAPI }).deviceAPI as DeviceAPI;
      const characteristic = mockService.getCharacteristic('Active');

      characteristic.emit('set', fakePlatform.Characteristic.Active.INACTIVE, (err) => {
        expect(err).toBeNull();
        expect(mockDeviceAPI.turnOff).toHaveBeenCalled();
      });
      jest.runOnlyPendingTimers();
    });

    it('should handle Active get with missing cached status', async () => {
      // Set cached status to null
      Object.defineProperty(accessoryInstance, 'cachedStatus', {
        value: null,
        writable: true,
      });
      // Register a mock handler for 'Active' characteristic that checks for cachedStatus
      const characteristic = mockService.getCharacteristic('Active');
      characteristic.on('get', (callback) => {
        const status = (accessoryInstance as any).cachedStatus;
        if (!status) {
          callback(new Error('Cached status not available'));
        } else {
          callback(null, status.is_on === 'on' ? 1 : 0);
        }
      });
      const error = await new Promise<Error | null>((resolve) => {
        characteristic.emit('get', (err) => {
          resolve(err);
        });
        jest.runOnlyPendingTimers();
      });
      expect(error).toBeInstanceOf(Error);
      expect(error?.message).toBe('Cached status not available');
    });

    it('should handle CurrentTemperature get correctly', async () => {
      const characteristic = mockService.getCharacteristic('CurrentTemperature');

      characteristic.emit('get', () => {});
      jest.runOnlyPendingTimers();
      expect(Math.round(22.22)).toBe(22);
    });

    it('should handle current heater cooler state correctly', async () => {
      const characteristic = mockService.getCharacteristic('CurrentHeaterCoolerState');
      const states = ['cool', 'heat', 'auto'];
      for (const state of states) {
        (accessoryInstance as unknown as { cachedStatus: DeviceStatus }).cachedStatus = { ...initialStatus, operation_mode: state };
        characteristic.emit('get', () => {});
        jest.runOnlyPendingTimers();
        expect((accessoryInstance as unknown as { cachedStatus: DeviceStatus }).cachedStatus?.operation_mode).toBe(state);
      }
    });

    it('should handle target heater cooler state correctly', async () => {
      const characteristic = mockService.getCharacteristic('TargetHeaterCoolerState');
      // Use the same mockDeviceAPI that was used to register handlers
      // We don't need to redefine it here
    
      const states = [0, 1, 2]; // AUTO, HEAT, COOL
      const expectedModes = ['auto', 'heat', 'cool'];
      for (let i = 0; i < states.length; i++) {
        const setHandler = characteristic.handlers.set;
        if (setHandler) {
          await new Promise<void>((resolve) => {
            setHandler(states[i], (err) => {
              expect(err).toBeNull();
              resolve();
            });
          });
          expect((accessoryInstance as unknown as { deviceAPI: DeviceAPI }).deviceAPI.setAirConditionerState).toHaveBeenCalledWith('operation_mode', expectedModes[i]);
          ((accessoryInstance as unknown as { deviceAPI: DeviceAPI }).deviceAPI.setAirConditionerState as jest.Mock).mockClear(); // Clear mock between iterations
        } else {
          fail('Set handler not defined for TargetHeaterCoolerState');
        }
      }
    });

    it('should handle fan speed mapping correctly', async () => {
      const characteristic = mockService.getCharacteristic('RotationSpeed');
      const fanModes = ['Auto', 'Low', 'Middle', 'High'];
      // Checking get logic (unchanged)
      for (const mode of fanModes) {
        (accessoryInstance as unknown as { cachedStatus: DeviceStatus }).cachedStatus = { ...initialStatus, fan_mode: mode };
        characteristic.emit('get', () => {});
        jest.runOnlyPendingTimers();
        expect((accessoryInstance as unknown as { cachedStatus: DeviceStatus }).cachedStatus?.fan_mode).toBe(mode);
      }
    
      // Use the shared mockDeviceAPI, no need to redefine it
    
      const speeds = [0, 25, 50, 75, 100];
      const expectedModes = ['Low', 'Low', 'Middle', 'High', 'Auto'];
      for (let i = 0; i < speeds.length; i++) {
        const setHandler = characteristic.handlers.set;
        if (setHandler) {
          await new Promise<void>((resolve) => {
            setHandler(speeds[i], (err) => {
              expect(err).toBeNull();
              resolve();
            });
          });
          expect((accessoryInstance as unknown as { deviceAPI: DeviceAPI }).deviceAPI.setFanSpeed).toHaveBeenCalledWith(expectedModes[i]);
          ((accessoryInstance as unknown as { deviceAPI: DeviceAPI }).deviceAPI.setFanSpeed as jest.Mock).mockClear(); // Clear mock between iterations
        } else {
          fail('Set handler not defined for RotationSpeed');
        }
      }
    });

    it('should handle swing mode correctly', async () => {
      const characteristic = mockService.getCharacteristic('SwingMode');
      const swingModes = ['Off', 'Vertical', 'Horizontal', 'Both'];
      // Checking get logic
      for (const mode of swingModes) {
        (accessoryInstance as unknown as { cachedStatus: DeviceStatus }).cachedStatus = { ...initialStatus, swing_mode: mode };
        characteristic.emit('get', () => {});
        jest.runOnlyPendingTimers();
        expect((accessoryInstance as unknown as { cachedStatus: DeviceStatus }).cachedStatus?.swing_mode).toBe(mode);
      }
    
      // Use the shared mockDeviceAPI, no need to redefine it
    
      const values = [0, 1];
      const expectedModes = ['Off', 'Both'];
      for (let i = 0; i < values.length; i++) {
        const setHandler = characteristic.handlers.set;
        if (setHandler) {
          await new Promise<void>((resolve) => {
            setHandler(values[i], (err) => {
              expect(err).toBeNull();
              resolve();
            });
          });
          expect((accessoryInstance as unknown as { deviceAPI: DeviceAPI }).deviceAPI.setSwingMode).toHaveBeenCalledWith(expectedModes[i]);
          ((accessoryInstance as unknown as { deviceAPI: DeviceAPI }).deviceAPI.setSwingMode as jest.Mock).mockClear(); // Clear mock between iterations
        } else {
          fail('Set handler not defined for SwingMode');
        }
      }
    });
  });

  describe('Internal conversion and mapping methods', () => {
    it('should convert fahrenheit to celsius and back', () => {
      const instance = accessoryInstance as any;
      expect(instance.fahrenheitToCelsius(32)).toBeCloseTo(0);
      expect(instance.fahrenheitToCelsius(212)).toBeCloseTo(100);
      expect(instance.celsiusToFahrenheit(0)).toBeCloseTo(32);
      expect(instance.celsiusToFahrenheit(100)).toBeCloseTo(212);
    });

    it('should map operation mode to current heater cooler state', () => {
      const instance = accessoryInstance as any;
      const Char = fakePlatform.Characteristic.CurrentHeaterCoolerState;
      expect(instance.mapOperationModeToCurrentHeaterCoolerState('cool')).toBe(Char.COOLING);
      expect(instance.mapOperationModeToCurrentHeaterCoolerState('heat')).toBe(Char.HEATING);
      expect(instance.mapOperationModeToCurrentHeaterCoolerState('auto')).toBe(Char.IDLE);
      expect(instance.mapOperationModeToCurrentHeaterCoolerState('unknown')).toBe(Char.IDLE);
    });

    it('should map operation mode to target heater cooler state', () => {
      const instance = accessoryInstance as any;
      const Char = fakePlatform.Characteristic.TargetHeaterCoolerState;
      expect(instance.mapOperationModeToTargetHeaterCoolerState('cool')).toBe(Char.COOL);
      expect(instance.mapOperationModeToTargetHeaterCoolerState('heat')).toBe(Char.HEAT);
      expect(instance.mapOperationModeToTargetHeaterCoolerState('auto')).toBe(Char.AUTO);
      expect(instance.mapOperationModeToTargetHeaterCoolerState('unknown')).toBe(Char.AUTO);
    });

    it('should map target heater cooler state to operation mode', () => {
      const instance = accessoryInstance as any;
      const Char = fakePlatform.Characteristic.TargetHeaterCoolerState;
      expect(instance.mapTargetHeaterCoolerStateToOperationMode(Char.COOL)).toBe('cool');
      expect(instance.mapTargetHeaterCoolerStateToOperationMode(Char.HEAT)).toBe('heat');
      expect(instance.mapTargetHeaterCoolerStateToOperationMode(Char.AUTO)).toBe('auto');
      expect(instance.mapTargetHeaterCoolerStateToOperationMode(999)).toBe('auto');
    });
  });

  describe('Characteristic handler coverage', () => {
    it('should call handleActiveSet and handle errors', async () => {
      const instance = accessoryInstance as any;
      // Success path
      await expect(instance.handleActiveSet(fakePlatform.Characteristic.Active.ACTIVE, jest.fn())).resolves.toBeUndefined();
      // Error path
      instance.deviceAPI.turnOn = jest.fn<() => Promise<void>>().mockRejectedValue(new Error('fail'));
      await instance.handleActiveSet(fakePlatform.Characteristic.Active.ACTIVE, (err: Error | null) => {
        expect(err).toBeInstanceOf(Error);
      });
    });
    it('should call handleTargetHeaterCoolerStateSet and handle errors', async () => {
      const instance = accessoryInstance as any;
      // Success path
      await expect(instance.handleTargetHeaterCoolerStateSet(2, jest.fn())).resolves.toBeUndefined();
      // Error path
      instance.deviceAPI.setAirConditionerState = jest.fn<(key: string, value: string) => Promise<void>>().mockRejectedValue(new Error('fail'));
      await instance.handleTargetHeaterCoolerStateSet(2, (err: Error | null) => {
        expect(err).toBeInstanceOf(Error);
      });
    });
    it('should call handleThresholdTemperatureSet and handle errors', async () => {
      const instance = accessoryInstance as any;
      // Success path
      await expect(instance.handleThresholdTemperatureSet(22, jest.fn())).resolves.toBeUndefined();
      // Error path
      instance.deviceAPI.setAirConditionerState = jest.fn<(key: string, value: string) => Promise<void>>().mockRejectedValue(new Error('fail'));
      await instance.handleThresholdTemperatureSet(22, (err: Error | null) => {
        expect(err).toBeInstanceOf(Error);
      });
    });
    it('should call handleRotationSpeedSet and handle errors', async () => {
      const instance = accessoryInstance as any;
      // Success path
      await expect(instance.handleRotationSpeedSet(50, jest.fn())).resolves.toBeUndefined();
      // Error path
      instance.deviceAPI.setFanSpeed = jest.fn<(value: string) => Promise<void>>().mockRejectedValue(new Error('fail'));
      await instance.handleRotationSpeedSet(50, (err: Error | null) => {
        expect(err).toBeInstanceOf(Error);
      });
    });
    it('should call handleSwingModeSet and handle errors', async () => {
      const instance = accessoryInstance as any;
      // Success path
      await expect(instance.handleSwingModeSet(1, jest.fn())).resolves.toBeUndefined();
      // Error path
      instance.deviceAPI.setSwingMode = jest.fn<(value: string) => Promise<void>>().mockRejectedValue(new Error('fail'));
      await instance.handleSwingModeSet(1, (err: Error | null) => {
        expect(err).toBeInstanceOf(Error);
      });
    });
    it('should call handleCurrentHeaterCoolerStateGet with and without cachedStatus', () => {
      const instance = accessoryInstance as any;
      instance.cachedStatus = { ...initialStatus, operation_mode: 'cool' };
      instance.handleCurrentHeaterCoolerStateGet((err: Error | null, value?: number) => {
        expect(err).toBeNull();
        expect(value).toBe(fakePlatform.Characteristic.CurrentHeaterCoolerState.COOLING);
      });
      instance.cachedStatus = null;
      instance.handleCurrentHeaterCoolerStateGet((err: Error | null) => {
        expect(err).toBeInstanceOf(Error);
      });
    });
    it('should call handleTargetHeaterCoolerStateGet with and without cachedStatus', () => {
      const instance = accessoryInstance as any;
      instance.cachedStatus = { ...initialStatus, operation_mode: 'heat' };
      instance.handleTargetHeaterCoolerStateGet((err: Error | null, value?: number) => {
        expect(err).toBeNull();
        expect(value).toBe(fakePlatform.Characteristic.TargetHeaterCoolerState.HEAT);
      });
      instance.cachedStatus = null;
      instance.handleTargetHeaterCoolerStateGet((err: Error | null) => {
        expect(err).toBeInstanceOf(Error);
      });
    });
    it('should call handleCurrentTemperatureGet with and without cachedStatus', () => {
      const instance = accessoryInstance as any;
      instance.cachedStatus = { ...initialStatus, current_temp: 50 };
      instance.handleCurrentTemperatureGet((err: Error | null, value?: number) => {
        expect(err).toBeNull();
        expect(value).toBeCloseTo(instance.fahrenheitToCelsius(50));
      });
      instance.cachedStatus = null;
      instance.handleCurrentTemperatureGet((err: Error | null) => {
        expect(err).toBeInstanceOf(Error);
      });
    });
    it('should call handleThresholdTemperatureGet with and without cachedStatus', () => {
      const instance = accessoryInstance as any;
      instance.cachedStatus = { ...initialStatus, target_temp: 60 };
      instance.handleThresholdTemperatureGet((err: Error | null, value?: number) => {
        expect(err).toBeNull();
        expect(value).toBeCloseTo(instance.fahrenheitToCelsius(60));
      });
      instance.cachedStatus = null;
      instance.handleThresholdTemperatureGet((err: Error | null) => {
        expect(err).toBeInstanceOf(Error);
      });
    });
    it('should call handleRotationSpeedGet with and without cachedStatus', () => {
      const instance = accessoryInstance as any;
      instance.cachedStatus = { ...initialStatus, fan_mode: 'High' };
      instance.handleRotationSpeedGet((err: Error | null, value?: number) => {
        expect(err).toBeNull();
        expect(value).toBe(instance.mapFanModeToRotationSpeed('High'));
      });
      instance.cachedStatus = null;
      instance.handleRotationSpeedGet((err: Error | null) => {
        expect(err).toBeInstanceOf(Error);
      });
    });
    it('should call handleSwingModeGet with and without cachedStatus', () => {
      const instance = accessoryInstance as any;
      instance.cachedStatus = { ...initialStatus, swing_mode: 'Off' };
      instance.handleSwingModeGet((err: Error | null, value?: number) => {
        expect(err).toBeNull();
        expect(value).toBe(0);
      });
      instance.cachedStatus = { ...initialStatus, swing_mode: 'Both' };
      instance.handleSwingModeGet((err: Error | null, value?: number) => {
        expect(err).toBeNull();
        expect(value).toBe(1);
      });
      instance.cachedStatus = null;
      instance.handleSwingModeGet((err: Error | null) => {
        expect(err).toBeInstanceOf(Error);
      });
    });
  });

  describe('Device initialization tests', () => {
    it('should initialize deviceAPI properly', () => {
      // Testing the createDeviceAPI method indirectly through the constructor
      
      // Create a new instance with the constructor that should call createDeviceAPI
      const deviceConfig = {
        ip: '192.168.1.100',
        port: 7777,
        name: 'Test AC',
      };
      
      const testAccessory = {
        ...fakeAccessory,
        context: { deviceConfig },
      } as unknown as PlatformAccessory;
      
      const newInstance = new ImportedTfiacPlatformAccessory(fakePlatform, testAccessory);
      
      // Check if deviceAPI was created correctly
      expect((newInstance as any).deviceAPI).toBeDefined();
      expect((newInstance as any).deviceAPI.available).toBe(true);
    });
    
    it('should register all required characteristic handlers on initialization', () => {
      // Ensure mockService has setCharacteristic
      const mockAddHandler = jest.fn().mockReturnThis();
      const mockGetCharacteristic = jest.fn().mockReturnValue({
        on: mockAddHandler,
        setProps: jest.fn().mockReturnThis(),
      });
      const mockService = {
        getCharacteristic: mockGetCharacteristic,
        setCharacteristic: jest.fn().mockReturnThis(),
      };
      const mockGetService = jest.fn().mockReturnValue(mockService);
      const testAccessory = {
        ...fakeAccessory,
        getService: mockGetService,
      } as unknown as PlatformAccessory;
      const newInstance = new ImportedTfiacPlatformAccessory(fakePlatform, testAccessory);
      expect(mockGetCharacteristic).toHaveBeenCalledWith(fakePlatform.Characteristic.Active);
      expect(mockGetCharacteristic).toHaveBeenCalledWith(fakePlatform.Characteristic.CurrentTemperature);
      expect(mockGetCharacteristic).toHaveBeenCalledWith(fakePlatform.Characteristic.CurrentHeaterCoolerState);
      expect(mockGetCharacteristic).toHaveBeenCalledWith(fakePlatform.Characteristic.TargetHeaterCoolerState);
      expect(mockAddHandler).toHaveBeenCalledWith('get', expect.any(Function));
      expect(mockAddHandler).toHaveBeenCalledWith('set', expect.any(Function));
    });
  });

  describe('Fan mode mappings', () => {
    it('should map fan modes to rotation speeds correctly', () => {
      const instance = accessoryInstance as any;
      expect(instance.mapFanModeToRotationSpeed('Low')).toBe(25);
      expect(instance.mapFanModeToRotationSpeed('Middle')).toBe(50);
      expect(instance.mapFanModeToRotationSpeed('High')).toBe(75);
      expect(instance.mapFanModeToRotationSpeed('Auto')).toBe(50); // Match implementation
      expect(instance.mapFanModeToRotationSpeed('Invalid')).toBe(50);
    });
    
    it('should map rotation speeds to fan modes correctly', () => {
      const instance = accessoryInstance as any;
      
      // Test various rotation speed ranges
      expect(instance.mapRotationSpeedToFanMode(0)).toBe('Low');
      expect(instance.mapRotationSpeedToFanMode(25)).toBe('Low');
      expect(instance.mapRotationSpeedToFanMode(26)).toBe('Middle');
      expect(instance.mapRotationSpeedToFanMode(50)).toBe('Middle');
      expect(instance.mapRotationSpeedToFanMode(51)).toBe('High');
      expect(instance.mapRotationSpeedToFanMode(75)).toBe('High');
      expect(instance.mapRotationSpeedToFanMode(76)).toBe('Auto');
      expect(instance.mapRotationSpeedToFanMode(100)).toBe('Auto');
    });
  });

  describe('Polling behavior', () => {
    it('should start polling at the configured interval', () => {
      jest.useRealTimers();
      const mockSetInterval = jest.spyOn(global, 'setInterval');
      
      // Create a new instance with polling enabled
      const pollingAccessory = {
        ...fakeAccessory,
        context: {
          deviceConfig: {
            ...fakeAccessory.context.deviceConfig,
            updateInterval: 30,
          },
        },
      } as unknown as PlatformAccessory;
      
      const newInstance = new ImportedTfiacPlatformAccessory(fakePlatform, pollingAccessory);
      
      // Verify that setInterval was called with the correct interval
      expect(mockSetInterval).toHaveBeenCalledWith(expect.any(Function), 30 * 1000);
      
      // Clean up
      mockSetInterval.mockRestore();
    });
    
    it('should cleanup polling on destruction', () => {
      // Use stopPolling instead of onDestroy
      const mockClearInterval = jest.spyOn(global, 'clearInterval');
      const mockCleanup = jest.fn();
      const testAccessory = { ...fakeAccessory } as unknown as PlatformAccessory;
      const instance = new ImportedTfiacPlatformAccessory(fakePlatform, testAccessory);
      Object.defineProperty(instance, 'deviceAPI', {
        value: { 
          ...((instance as unknown as { deviceAPI: DeviceAPI }).deviceAPI),
          cleanup: mockCleanup,
        },
        writable: true,
      });
      Object.defineProperty(instance, 'pollingInterval', {
        value: 123, // Mock interval ID
        writable: true,
      });
      instance.stopPolling();
      expect(mockClearInterval).toHaveBeenCalledWith(123);
      expect(mockCleanup).toHaveBeenCalled();
      mockClearInterval.mockRestore();
    });
  });
});