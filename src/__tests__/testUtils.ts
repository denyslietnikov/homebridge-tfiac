/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
// src/__tests__/testUtils.ts
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
import { TfiacPlatform } from '../platform.js';
import { TfiacDeviceConfig } from '../settings.js';
import { PLATFORM_NAME } from '../settings.js';

// Common types for mocks
export interface MockLogger extends Partial<Logging> {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
  log: jest.Mock;
  success: jest.Mock;
}

// Define MockApiActions interface based on createMockApiActions return type
export interface MockApiActions {
  updateState: jest.Mock;
  turnOn: jest.Mock;
  turnOff: jest.Mock;
  setAirConditionerState: jest.Mock;
  setFanSpeed: jest.Mock;
  setSwingMode: jest.Mock;
  setTurboState: jest.Mock;
  setEcoState: jest.Mock;
  setDisplayState: jest.Mock;
  setBeepState: jest.Mock;
  setSleepState: jest.Mock;
  cleanup: jest.Mock;
}

// Use a more flexible type for hap to avoid deep compatibility issues
// Define MockAPI as a standalone interface with necessary mocked properties
export interface MockAPI {
  hap: any; // Keep 'any' for flexibility in mocking hap internals
  registerPlatformAccessories: jest.Mock;
  updatePlatformAccessories: jest.Mock;
  unregisterPlatformAccessories: jest.Mock;
  // Mock platformAccessory as a function returning a PlatformAccessory-like object
  platformAccessory: jest.Mock<PlatformAccessory, [string, string]>;
  on: jest.Mock;
  emit: jest.Mock; // Add emit if needed by tests using API events
  removeAccessories: jest.Mock; // Add removeAccessories if needed
  // Add other API methods/properties used in tests if necessary
}

// Helper function to create a mocked Homebridge logger
export function createMockLogger(): MockLogger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
    success: jest.fn(),
  } as MockLogger;
}

// Helper to create a mock characteristic
export function createMockCharacteristic() {
  const onMethod = function (this: any, event: 'get' | 'set', handler: any): any {
    if (event === 'get') {
      this.getHandler = handler;
    } else {
      this.setHandler = handler;
    }
    return this;
  };

  return {
    value: null,
    getHandler: undefined,
    setHandler: undefined,
    on: jest.fn(onMethod),
    setProps: jest.fn().mockReturnThis(),
    updateValue: jest.fn(function (this: any, newValue: CharacteristicValue) {
      this.value = newValue;
      return this;
    }),
  };
}

// Helper to create a mock service that better matches the Service interface
export function createMockService(): any {
  const characteristics = new Map<string, any>();

  const mockService = {
    characteristics,
    UUID: 'mock-service-uuid',
    displayName: 'Mock Service',
    iid: 1,
    name: 'Mock Service',
    subtype: undefined,
    on: jest.fn().mockReturnThis(),
    emit: jest.fn().mockReturnValue(true),
    getCharacteristic: jest.fn((charIdentifier: any) => {
      const key =
        charIdentifier && typeof charIdentifier === 'object' && 'UUID' in charIdentifier
          ? (charIdentifier as { UUID: string }).UUID
          : String(charIdentifier);
      if (!characteristics.has(key)) {
        characteristics.set(key, createMockCharacteristic());
      }
      return characteristics.get(key)!;
    }),
    setCharacteristic: jest.fn(function (this: any, charIdentifier: any, value: CharacteristicValue) {
      const mockChar = this.getCharacteristic(charIdentifier);
      mockChar.updateValue(value);
      return this;
    }),
    updateCharacteristic: jest.fn(function (this: any, charIdentifier: any, value: any) {
      const mockChar = this.getCharacteristic(charIdentifier);
      mockChar.updateValue(value);
      return this;
    }),
    addCharacteristic: jest.fn().mockReturnThis(),
    removeCharacteristic: jest.fn(),
    getServiceId: jest.fn().mockReturnValue('mock-service-id'),
  };
  
  return mockService;
}

// Helper to create a mock platform accessory with default values for optional parameters
export function createMockPlatformAccessory(
  displayName: string = 'Mock Accessory',
  uuid: string = 'mock-uuid',
  deviceConfig: TfiacDeviceConfig = { name: 'Mock Device', ip: '1.2.3.4' },
  mockService?: any,
): PlatformAccessory {
  const service = mockService || createMockService();

  return {
    context: { deviceConfig },
    displayName,
    UUID: uuid,
    category: Categories.AIR_CONDITIONER,
    getService: jest.fn().mockReturnValue(service),
    addService: jest.fn().mockReturnValue(service),
    services: [service],
    on: jest.fn().mockReturnThis(),
    emit: jest.fn().mockReturnValue(true),
    removeService: jest.fn(),
    getServiceById: jest.fn(),
  } as unknown as PlatformAccessory;
}

// API mocking for common Homebridge API features
export function createMockAPI(customUuid?: string): MockAPI {
  // Common Characteristic constant values used in tests
  const characteristicValues = {
    TargetHeaterCoolerState: {
      AUTO: 0,
      HEAT: 1,
      COOL: 2,
    },
    CurrentHeaterCoolerState: {
      INACTIVE: 0,
      IDLE: 1,
      HEATING: 2,
      COOLING: 3,
    },
    TemperatureDisplayUnits: {
      CELSIUS: 0,
      FAHRENHEIT: 1,
    },
    Active: {
      INACTIVE: 0,
      ACTIVE: 1,
    },
    SwingMode: {
      SWING_DISABLED: 0,
      SWING_ENABLED: 1,
    },
  };

  // Create a Characteristic constructor mock with common constants
  const CharacteristicMock = function (this: any) {
    // Each property is manually created for each Characteristic
    this.UUID = 'mock-uuid';
  } as unknown as typeof Characteristic & { [key: string]: any };

  // Add all characteristic values to the mock
  Object.entries(characteristicValues).forEach(([key, values]) => {
    CharacteristicMock[key] = key;
    Object.entries(values).forEach(([valueKey, value]) => {
      if (!CharacteristicMock[key] || typeof CharacteristicMock[key] !== 'object') {
        CharacteristicMock[key] = {};
      }
      CharacteristicMock[key][valueKey] = value;
    });
    // Ensure a UUID property so tests that pass the characteristic object get the same key
    (CharacteristicMock[key] as any).UUID = key;
  });

  // Common individual characteristics used in the tests.
  // Provide a minimal shape (`UUID` and an empty `prototype`) so TS accepts
  // them as `typeof Characteristic` while still being lightweight mocks.
  (CharacteristicMock as any).Name = { UUID: 'Name', prototype: {} };
  (CharacteristicMock as any).RotationSpeed = { UUID: 'RotationSpeed', prototype: {} };

  // Cast simple constants directly.
  (CharacteristicMock as any).On = 'On';

  const ServiceMock = function (this: any) {
    this.UUID = 'mock-service-uuid';
  } as unknown as typeof Service & { [key: string]: any };

  // Add common service identifiers
  ['HeaterCooler', 'TemperatureSensor', 'Switch', 'Fan', 'Fanv2'].forEach((service) => {
    ServiceMock[service] = { UUID: `mock-${service.toLowerCase()}-uuid` };
  });

  // Create a non-enum copy of Categories - Manually specify needed categories
  const categoriesCopy = {
    AIR_CONDITIONER: Categories.AIR_CONDITIONER,
  };

  return {
    hap: {
      Service: ServiceMock,
      Characteristic: CharacteristicMock,
      uuid: {
        generate: jest.fn().mockReturnValue(customUuid || 'generated-uuid'),
      },
      Categories: categoriesCopy, // Use the manually created copy
    },
    registerPlatformAccessories: jest.fn(),
    updatePlatformAccessories: jest.fn(),
    unregisterPlatformAccessories: jest.fn(),
    // Ensure the mock function signature matches the interface
    platformAccessory: jest.fn((name, uuid) => createMockPlatformAccessory(name, uuid, { name, ip: '1.2.3.4' })),
    on: jest.fn(),
    emit: jest.fn(), // Add mock implementation if needed
    removeAccessories: jest.fn(), // Add mock implementation if needed
  } as MockAPI; // Cast to the standalone MockAPI interface
}

// Create mock API actions for AirConditionerAPI
export function createMockApiActions(initialStatus = {}): MockApiActions {
  const actions = {
    updateState: jest.fn().mockResolvedValue(initialStatus),
    turnOn: jest.fn().mockResolvedValue(undefined),
    turnOff: jest.fn().mockResolvedValue(undefined),
    setAirConditionerState: jest.fn().mockResolvedValue(undefined),
    setFanSpeed: jest.fn().mockResolvedValue(undefined),
    setSwingMode: jest.fn().mockResolvedValue(undefined),
    setTurboState: jest.fn().mockResolvedValue(undefined),
    setEcoState: jest.fn().mockResolvedValue(undefined),
    setDisplayState: jest.fn().mockResolvedValue(undefined),
    setBeepState: jest.fn().mockResolvedValue(undefined),
    setSleepState: jest.fn().mockResolvedValue(undefined),
    cleanup: jest.fn().mockResolvedValue(undefined),
  } as MockApiActions;
  // Expose mock actions globally for TfiacPlatformAccessory to use
  (global as any).mockApiActions = actions;
  return actions;
}

// Create a mock platform instance with common test configurations
export function setupTestPlatform(
  config: Partial<PlatformConfig> = {},
  customLogger?: MockLogger,
  customAPI?: MockAPI,
): TfiacPlatform {
  const logger = customLogger || createMockLogger();
  const api = customAPI || createMockAPI();

  const defaultConfig = {
    name: PLATFORM_NAME,
    platform: PLATFORM_NAME,
    devices: [{ name: 'Test AC', ip: '192.168.1.99', port: 7777 }],
    ...config,
  };

  return new TfiacPlatform(logger as unknown as Logging, defaultConfig as PlatformConfig, api as unknown as API);
}

// Helper to create a mock PlatformConfig for tests
export function createMockPlatformConfig(
  config: Partial<PlatformConfig> & { devices: TfiacDeviceConfig[] },
): PlatformConfig {
  return {
    name: PLATFORM_NAME,
    platform: PLATFORM_NAME,
    enableDiscovery: true,
    ...config,
  } as PlatformConfig;
}

// Alias setupTestPlatform as createMockPlatform for compatibility with older tests
export const createMockPlatform = setupTestPlatform;
// Alias setupTestPlatform for characteristic tests
export const mockPlatform = setupTestPlatform();
// Alias createMockPlatformAccessory for compatibility with older tests, but wrap in jest.fn for easier mocking/resetting in tests
export const mockPlatformAccessory: jest.Mock<any, [string, string]> = jest
  .fn((displayName: string, uuid: string) =>
    createMockPlatformAccessory(displayName, uuid),
  ) as unknown as jest.Mock<any, [string, string]>;

// Helper function to get characteristic handlers from service mock
export function getHandlerByIdentifier(
  service: any,
  charIdentifier: any,
  eventType: 'get' | 'set',
): ((callback: CharacteristicGetCallback) => void) | ((value: CharacteristicValue, callback: CharacteristicSetCallback) => void) {
  // Get the accessory from the service if it's available
  const accessory = service.accessory;
  
  // If we can access the TfiacPlatformAccessory instance
  if (accessory && accessory.getCharacteristicHandler) {
    // Extract the characteristic name or UUID
    const charId = typeof charIdentifier === 'string' 
      ? charIdentifier 
      : charIdentifier.UUID || charIdentifier;
    
    // Try to get handler from the accessory's handler system
    const handler = accessory.getCharacteristicHandler(charId, eventType);
    if (handler) {
      return handler;
    }
  }
  
  // Fall back to the old approach
  const char = service.getCharacteristic(charIdentifier);
  return eventType === 'get' ? char.getHandler : char.setHandler;
}

// Common initial status values for tests
export const initialStatusFahrenheit = {
  is_on: 'on',
  current_temp: 68,
  target_temp: 68,
  operation_mode: 'auto',
  fan_mode: 'Low',
  swing_mode: 'Off',
  outdoor_temp: 68,
  opt_super: 'off',
  opt_eco: 'off',
  opt_display: 'on',
  opt_beep: 'on',
  opt_sleepMode: 'off',
};

export const initialStatusCelsius = {
  is_on: 'on',
  current_temp: 20,
  target_temp: 20,
  operation_mode: 'auto',
  fan_mode: 'Low',
  swing_mode: 'Off',
  outdoor_temp: 20,
  opt_super: 'off',
  opt_eco: 'off',
  opt_display: 'on',
  opt_beep: 'on',
  opt_sleepMode: 'off',
};

// Helper for temperature conversions in tests
export function toFahrenheit(celsius: number): number {
  return (celsius * 9) / 5 + 32;
}

export function toCelsius(fahrenheit: number): number {
  return ((fahrenheit - 32) * 5) / 9;
}

// Identifiers for characteristic names used in tests
export const hapIdentifiers = {
  Characteristic: {
    CoolingThresholdTemperature: 'CoolingThresholdTemperature',
    HeatingThresholdTemperature: 'HeatingThresholdTemperature',
    CurrentTemperature: 'CurrentTemperature',
    RotationSpeed: 'RotationSpeed',
    SwingMode: 'SwingMode',
  },
};

// Mocked constants for HAP characteristics used in tests
export const hapConstants = createMockAPI().hap;