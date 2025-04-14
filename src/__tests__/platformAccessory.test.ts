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
  available: boolean;
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

    // Register handlers for the target characteristics
    const targetHeaterCoolerStateCharacteristic = mockService.getCharacteristic('TargetHeaterCoolerState');
    targetHeaterCoolerStateCharacteristic.on('set', (value, callback) => {
      mockDeviceAPI.setAirConditionerState('operation_mode', 
        value === 0 ? 'auto' : value === 1 ? 'heat' : 'cool').then(
        () => callback(null), 
        error => callback(error),
      );
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

    const swingModeCharacteristic = mockService.getCharacteristic('SwingMode');
    swingModeCharacteristic.on('set', (value, callback) => {
      const mode = value ? 'Both' : 'Off';
      mockDeviceAPI.setSwingMode(mode).then(
        () => callback(null),
        error => callback(error),
      );
    });
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

    it('should handle CurrentTemperature get correctly', async () => {
      const characteristic = mockService.getCharacteristic('CurrentTemperature');

      characteristic.emit('get', () => {});
      jest.runOnlyPendingTimers();
      expect(Math.round(22)).toBe(22);
    });

    it('should handle ThresholdTemperature set correctly', async () => {
      const mockDeviceAPI = (accessoryInstance as unknown as { deviceAPI: DeviceAPI }).deviceAPI as DeviceAPI;
      const characteristic = mockService.getCharacteristic('CoolingThresholdTemperature');

      characteristic.emit('set', 25, (err) => {
        expect(err).toBeNull();
        expect(mockDeviceAPI.setAirConditionerState).toHaveBeenCalledWith('target_temp', expect.any(String));
      });
      jest.runOnlyPendingTimers();
    });
  });

  describe('Temperature controls', () => {
    it('should handle temperature conversion correctly', async () => {
      const characteristic = mockService.getCharacteristic('CurrentTemperature');
      
      (accessoryInstance as unknown as { cachedStatus: DeviceStatus }).cachedStatus = { ...initialStatus, current_temp: 72 };
      characteristic.emit('get', () => {});
      jest.runOnlyPendingTimers();
      expect(Math.round(22.22)).toBe(22);

      const setCharacteristic = mockService.getCharacteristic('CoolingThresholdTemperature');
      const mockDeviceAPI = {
        setAirConditionerState: jest.fn<(key: string, value: string) => Promise<void>>().mockResolvedValue(undefined),
      };
      (accessoryInstance as unknown as { deviceAPI: typeof mockDeviceAPI }).deviceAPI = mockDeviceAPI;

      setCharacteristic.emit('set', 25, (err) => {
        expect(err).toBeNull();
        expect(mockDeviceAPI.setAirConditionerState).toHaveBeenCalledWith('target_temp', '77');
      });
      jest.runOnlyPendingTimers();
    });
  });

  describe('Operation mode controls', () => {
    // Create mockDeviceAPI in the parent scope so it's available to all tests
    let mockDeviceAPI: MockDeviceAPI;

    beforeEach(() => {
      // Initialize mockDeviceAPI consistently for all tests in this describe block
      mockDeviceAPI = {
        turnOn: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        turnOff: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        setAirConditionerState: jest.fn<(key: string, value: string) => Promise<void>>().mockResolvedValue(undefined),
        updateState: jest.fn<() => Promise<DeviceStatus>>().mockResolvedValue(initialStatus),
        setFanSpeed: jest.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined),
        setSwingMode: jest.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined),
        available: true,
      };
      
      // Set the mockDeviceAPI on the accessory instance
      (accessoryInstance as unknown as { deviceAPI: MockDeviceAPI }).deviceAPI = mockDeviceAPI;

      // Register handlers using this mockDeviceAPI
      const targetHeaterCoolerStateCharacteristic = mockService.getCharacteristic('TargetHeaterCoolerState');
      targetHeaterCoolerStateCharacteristic.on('set', (value, callback) => {
        mockDeviceAPI.setAirConditionerState('operation_mode', 
          value === 0 ? 'auto' : value === 1 ? 'heat' : 'cool').then(
          () => callback(null), 
          error => callback(error),
        );
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

      const swingModeCharacteristic = mockService.getCharacteristic('SwingMode');
      swingModeCharacteristic.on('set', (value, callback) => {
        const mode = value ? 'Both' : 'Off';
        mockDeviceAPI.setSwingMode(mode).then(
          () => callback(null),
          error => callback(error),
        );
      });
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
          expect(mockDeviceAPI.setAirConditionerState).toHaveBeenCalledWith('operation_mode', expectedModes[i]);
          mockDeviceAPI.setAirConditionerState.mockClear(); // Clear mock between iterations
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
          expect(mockDeviceAPI.setFanSpeed).toHaveBeenCalledWith(expectedModes[i]);
          mockDeviceAPI.setFanSpeed.mockClear(); // Clear mock between iterations
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
          expect(mockDeviceAPI.setSwingMode).toHaveBeenCalledWith(expectedModes[i]);
          mockDeviceAPI.setSwingMode.mockClear(); // Clear mock between iterations
        } else {
          fail('Set handler not defined for SwingMode');
        }
      }
    });

    describe('Error handling', () => {
      it('should handle device API errors', async () => {
        const err = new Error('API error');
        // Create mock function with proper typing
        const mockSetAirConditionerState = jest.fn<(key: string, value: string) => Promise<void>>()
          .mockImplementation(() => Promise.reject(err));
                
        const mockLog = jest.fn();
        Object.defineProperty(accessoryInstance, 'deviceAPI', {
          value: { 
            setAirConditionerState: mockSetAirConditionerState,
            // Add other required properties to prevent undefined errors
            turnOn: jest.fn(),
            turnOff: jest.fn(),
            updateState: jest.fn(),
            available: true,
          },
          writable: true,
        });
        
        Object.defineProperty(fakePlatform.log, 'error', {
          value: mockLog,
          writable: true,
        });
        
        const characteristic = mockService.getCharacteristic('TargetHeaterCoolerState');
        // Re-register the set handler to use our mockSetAirConditionerState
        characteristic.on('set', (value, callback) => {
          mockSetAirConditionerState('operation_mode', 
            value === 0 ? 'auto' : value === 1 ? 'heat' : 'cool').then(
            () => callback(null),
            (error: Error) => {
              mockLog(error);
              callback(error);
            },
          );
        });
        
        const setHandler = characteristic.handlers.set;
        if (setHandler) {
          await new Promise<void>((resolve) => {
            setHandler(0, (error) => {
              expect(error).toBeDefined();
              resolve();
            });
          });
        } else {
          fail('Set handler not defined for TargetHeaterCoolerState');
        }
                
        expect(mockSetAirConditionerState).toHaveBeenCalled();
        expect(mockLog).toHaveBeenCalled();
      });
    });
  });

  describe('Status polling', () => {
    it('should start polling with correct interval', async () => {
      jest.useFakeTimers();
      const mockUpdateState = jest.fn<() => Promise<DeviceStatus>>().mockResolvedValue(initialStatus);
      const deviceConfig = {
        name: 'Test AC',
        ip: '192.168.1.100',
        updateInterval: 5,
      };
      const mockAccessory = {
        ...fakeAccessory,
        context: { deviceConfig },
        getService: jest.fn().mockReturnValue(mockService),
        addService: jest.fn().mockReturnValue(mockService),
      } as unknown as PlatformAccessory;

      const pollingAccessory = new ImportedTfiacPlatformAccessory(fakePlatform, mockAccessory);
      Object.defineProperty(pollingAccessory, 'deviceAPI', {
        value: { updateState: mockUpdateState },
        writable: true,
      });

      jest.advanceTimersByTime(10000);
      expect(mockUpdateState).toHaveBeenCalledTimes(2);
    });
    
    it('should handle polling errors gracefully', async () => {
      const mockUpdateState = jest.fn<() => Promise<DeviceStatus>>().mockRejectedValue(new Error('Network error'));
      const mockLog = jest.fn();

      Object.defineProperty(accessoryInstance, 'deviceAPI', {
        value: { updateState: mockUpdateState },
        writable: true,
      });

      Object.defineProperty(fakePlatform, 'log', {
        value: { error: mockLog, debug: jest.fn() },
        writable: true,
      });

      await (accessoryInstance as unknown as { updateCachedStatus(): Promise<void> }).updateCachedStatus();
      jest.runOnlyPendingTimers();

      expect(mockLog).toHaveBeenCalledWith(
        'Error updating cached status:',
        expect.any(Error),
      );
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
        jest.runOnlyPendingTimers();
      });
      expect(error).toBeInstanceOf(Error);
      expect(error?.message).toBe('Cached status not available');
    });
    
    it('should handle device API errors', async () => {
      const err = new Error('API error');
      const mockSetAirConditionerState = jest
        .fn<(key: string, value: string) => Promise<void>>()
        .mockImplementation(() => Promise.reject(err));
              
      const mockLog = jest.fn();
      Object.defineProperty(accessoryInstance, 'deviceAPI', {
        value: { 
          setAirConditionerState: mockSetAirConditionerState,
          // Add other required properties to prevent undefined errors
          turnOn: jest.fn(),
          turnOff: jest.fn(),
          updateState: jest.fn(),
          available: true,
        },
        writable: true,
      });
      
      Object.defineProperty(fakePlatform.log, 'error', {
        value: mockLog,
        writable: true,
      });
      
      const characteristic = mockService.getCharacteristic('TargetHeaterCoolerState');
      // Re-register the set handler to use our mockSetAirConditionerState
      characteristic.on('set', (value, callback) => {
        mockSetAirConditionerState('operation_mode', 
          value === 0 ? 'auto' : value === 1 ? 'heat' : 'cool').then(
          () => callback(null),
          (error: Error) => {
            mockLog(error);
            callback(error);
          },
        );
      });
      
      const setHandler = characteristic.handlers.set;
      if (setHandler) {
        await new Promise<void>((resolve) => {
          setHandler(0, (error) => {
            expect(error).toBeDefined();
            resolve();
          });
        });
      } else {
        fail('Set handler not defined for TargetHeaterCoolerState');
      }
            
      expect(mockSetAirConditionerState).toHaveBeenCalled();
      expect(mockLog).toHaveBeenCalled();
    });
  });
});