// platformAccessory.test.ts

import { PlatformAccessory, Categories } from 'homebridge';
// Removed unused import for TfiacPlatformAccessory
import { TfiacPlatform } from '../platform';
import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import dgram from 'dgram';

// --- Типы для UDP мока
interface MockSocket {
  send: jest.Mock;
  on: jest.Mock;
  close: jest.Mock;
}

type UDPCallback = (error?: Error) => void;

// --- Мокаем UDP сокет
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

// --- Типы для HomeKit характеристик и сервисов
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

// --- Тип состояния устройства
interface DeviceStatus {
  is_on: string;
  current_temp: number;
  target_temp: number;
  operation_mode: string;
  fan_mode: string;
  swing_mode: string;
}

// --- Интерфейс для DeviceAPI
interface DeviceAPI {
  turnOn: () => Promise<void>;
  turnOff: () => Promise<void>;
  setAirConditionerState: (key: string, value: string) => Promise<void>;
  updateState: () => Promise<DeviceStatus>;
  available: boolean;
}

// Add type declaration for TfiacPlatformAccessory
import { TfiacPlatformAccessory as ImportedTfiacPlatformAccessory } from '../platformAccessory';

// --- Мок характеристик
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
      };
    },
    setProps() {
      return this;
    },
  };
  return mock;
};

// --- Мок сервиса
const createMockService = (): MockedService => {
  const characteristics = new Map<string, MockedCharacteristic>();
  interface CharacteristicType {
    ACTIVE?: unknown;
    CurrentTemperature?: unknown;
    CoolingThresholdTemperature?: unknown;
  }

  const getKey = (characteristic: CharacteristicType | string | number): string => {
    if (typeof characteristic === 'object' && characteristic !== null && 'ACTIVE' in characteristic) {
      return 'Active';
    }
    if (typeof characteristic === 'object' && characteristic !== null && 'CurrentTemperature' in characteristic) {
      return 'CurrentTemperature';
    }
    if (typeof characteristic === 'object' && characteristic !== null && 'CoolingThresholdTemperature' in characteristic) {
      return 'CoolingThresholdTemperature';
    }
    return String(characteristic);
  };
  return {
    setCharacteristic() {
      return this;
    },
    getCharacteristic(characteristic: CharacteristicType | string | number) {
      const key = getKey(characteristic);
      if (!characteristics.has(key)) {
        characteristics.set(key, createMockCharacteristic());
      }
      return characteristics.get(key)!;
    },
  };
};

// --- Мок платформы
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

// --- Мок сервиса
const mockService = createMockService();

// --- Мок аксессуара
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

describe('TfiacPlatformAccessory', () => {
  let accessoryInstance: ImportedTfiacPlatformAccessory;
  let mockSocket: MockSocket;

  beforeAll(() => {
    jest.setTimeout(30000);
  });

  const initialStatus: DeviceStatus = {
    is_on: 'off',
    current_temp: 72,
    target_temp: 70,
    operation_mode: 'cool',
    fan_mode: 'Auto',
    swing_mode: 'Off',
  };

  beforeEach(() => {
    jest.useFakeTimers();
    mockSocket = (dgram.createSocket as jest.Mock)() as MockSocket;

    // Создаем новый экземпляр аксессуара
    accessoryInstance = new ImportedTfiacPlatformAccessory(fakePlatform, fakeAccessory);

    // Мокаем API устройства
    const mockDeviceAPI: DeviceAPI = {
      turnOn: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      turnOff: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      setAirConditionerState: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      updateState: jest.fn<() => Promise<DeviceStatus>>().mockResolvedValue(initialStatus),
      available: true,
    };

    Object.defineProperties(accessoryInstance, {
      cachedStatus: {
        value: { ...initialStatus },
        writable: true,
        configurable: true,
      },
      service: {
        value: mockService,
        writable: true,
        configurable: true,
      },
      deviceAPI: {
        value: mockDeviceAPI,
        writable: true,
        configurable: true,
      },
      updateInterval: {
        value: 0,
        writable: true,
        configurable: true,
      },
    });

    // Отключаем polling, если таковой запускается в конструкторе
    jest.spyOn(accessoryInstance as unknown as { startPolling: () => void }, 'startPolling').mockImplementation(() => {});
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
      Object.defineProperty(accessoryInstance, 'cachedStatus', {
        value: { ...initialStatus, is_on: 'on' },
        writable: true,
      });

      const characteristic = mockService.getCharacteristic('Active');

      const result = await new Promise<CharacteristicValue>((resolve) => {
        characteristic.emit('get', (err, value) => {
          expect(err).toBeNull();
          resolve(value as CharacteristicValue);
        });
      });

      expect(result).toBe(fakePlatform.Characteristic.Active.ACTIVE);
    });

    it('should handle Active set correctly', async () => {
      const mockDeviceAPI: DeviceAPI = {
        turnOn: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        turnOff: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        setAirConditionerState: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        updateState: jest.fn<() => Promise<DeviceStatus>>().mockResolvedValue(initialStatus),
        available: true,
      };

      Object.defineProperty(accessoryInstance, 'deviceAPI', {
        value: mockDeviceAPI,
        writable: true,
      });

      const characteristic = mockService.getCharacteristic('Active');

      await new Promise<void>((resolve) => {
        characteristic.emit('set', fakePlatform.Characteristic.Active.INACTIVE, (err) => {
          expect(err).toBeNull();
          expect(mockDeviceAPI.turnOff).toHaveBeenCalled();
          resolve();
        });
      });
    });

    it('should handle CurrentTemperature get correctly', async () => {
      const characteristic = mockService.getCharacteristic('CurrentTemperature');

      const result = await new Promise<CharacteristicValue>((resolve) => {
        characteristic.emit('get', (err, value) => {
          expect(err).toBeNull();
          resolve(value as CharacteristicValue);
        });
      });

      // 72°F преобразуется примерно в 22°C
      expect(Math.round(result as number)).toBe(22);
    });

    it('should handle ThresholdTemperature set correctly', async () => {
      const mockDeviceAPI: DeviceAPI = {
        turnOn: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        turnOff: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        setAirConditionerState: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        updateState: jest.fn<() => Promise<DeviceStatus>>().mockResolvedValue(initialStatus),
        available: true,
      };

      Object.defineProperty(accessoryInstance, 'deviceAPI', {
        value: mockDeviceAPI,
        writable: true,
      });

      const characteristic = mockService.getCharacteristic('CoolingThresholdTemperature');

      await new Promise<void>((resolve) => {
        characteristic.emit('set', 25, (err) => {
          expect(err).toBeNull();
          expect(mockDeviceAPI.setAirConditionerState).toHaveBeenCalledWith('target_temp', expect.any(String));
          resolve();
        });
      });
    });
  });

  describe('Error handling', () => {
    it('should throw error if cached status is missing', async () => {
      Object.defineProperty(accessoryInstance, 'cachedStatus', {
        value: null,
        writable: true,
      });

      const characteristic = mockService.getCharacteristic('CurrentTemperature');

      const error = await new Promise<Error | null>((resolve) => {
        characteristic.emit('get', (err) => {
          resolve(err);
        });
      });

      expect(error).toBeInstanceOf(Error);
      expect(error?.message).toBe('Cached status not available');
    });
  });
});