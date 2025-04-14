// platformAccessory.test.ts

import { PlatformAccessory, Categories } from 'homebridge';
// Removed unused import for TfiacPlatformAccessory
import { TfiacPlatform } from '../platform';
import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import dgram from 'dgram';

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
  emit(event: 'get', callback: GetCallback): void;
  emit(event: 'set', value: CharacteristicValue, callback: SetCallback): void;
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
    emit(event: 'get' | 'set', valueOrCallback: unknown, maybeCallback?: unknown) {
      const firstChar = Array.from(characteristics.values())[0] || createMockCharacteristic();
      if (event === 'get') {
        firstChar.emit('get', valueOrCallback as GetCallback);
      } else {
        firstChar.emit('set', valueOrCallback as CharacteristicValue, maybeCallback as SetCallback);
      }
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

    // The TfiacPlatformAccessory constructor should register its handlers with the service.
    // We rely on that internal registration and trigger handlers via emit in tests.
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
    it('should get and set Active characteristic via service', done => {
      const getCallback: GetCallback = (err, value) => {
        expect(err).toBeNull();
        expect(value).toBe(fakePlatform.Characteristic.Active.INACTIVE);
        done();
      };
      (accessoryInstance as unknown as { service: MockedService }).service.getCharacteristic('Active').emit('get', getCallback);
    });

    it('should handle error if cachedStatus is missing for Active', done => {
      (accessoryInstance as unknown as { cachedStatus: DeviceStatus | null }).cachedStatus = null;
      const getCallback: GetCallback = (err) => {
        expect(err).toBeInstanceOf(Error);
        done();
      };
      (accessoryInstance as unknown as { service: MockedService }).service.getCharacteristic('Active').emit('get', getCallback);
    });

    it('should get CurrentTemperature via service', done => {
      const getCallback: GetCallback = (err, value) => {
        expect(err).toBeNull();
        expect(typeof value).toBe('number');
        done();
      };
      (accessoryInstance as unknown as { service: MockedService }).service.getCharacteristic('CurrentTemperature').emit('get', getCallback);
    });

    it('should handle CurrentHeaterCoolerState via service', done => {
      const getCallback: GetCallback = (err, value) => {
        expect(err).toBeNull();
        expect(value).toBe(fakePlatform.Characteristic.CurrentHeaterCoolerState.COOLING);
        done();
      };
      (accessoryInstance as unknown as { service: MockedService }).service.getCharacteristic('CurrentHeaterCoolerState').emit('get', getCallback);
    });

    it('should handle TargetHeaterCoolerState via service', done => {
      const setCallback = (err: Error | null) => {
        expect(err).toBeNull();
        done();
      };
      (accessoryInstance as unknown as { service: MockedService }).service
        .getCharacteristic('TargetHeaterCoolerState')
        .emit('set', fakePlatform.Characteristic.TargetHeaterCoolerState.COOL, setCallback);
    });

    it('should handle RotationSpeed via service', done => {
      const setCallback = (err: Error | null) => {
        expect(err).toBeNull();
        done();
      };
      (accessoryInstance as unknown as { service: MockedService }).service.getCharacteristic('RotationSpeed').emit('set', 50, setCallback);
    });

    it('should handle SwingMode via service', done => {
      const setCallback = (err: Error | null) => {
        expect(err).toBeNull();
        done();
      };
      (accessoryInstance as unknown as { service: MockedService }).service.getCharacteristic('SwingMode').emit('set', 1, setCallback);
    });
  });
});