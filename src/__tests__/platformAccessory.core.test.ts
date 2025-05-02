// @ts-nocheck
// platformAccessory.core.test.ts

import {
  PlatformAccessory,
  Categories,
  CharacteristicValue,
  CharacteristicSetCallback,
  CharacteristicGetCallback,
} from 'homebridge';
import { TfiacPlatform } from '../platform.js';
import { TfiacPlatformAccessory } from '../platformAccessory.js';
import AirConditionerAPI, { AirConditionerStatus } from '../AirConditionerAPI.js';
import { TfiacDeviceConfig } from '../settings.js';
import { jest, describe, beforeEach, afterEach, it, expect, beforeAll } from '@jest/globals';
import {
  createMockService,
  createMockLogger,
  setupTestPlatform,
  initialStatusFahrenheit,
  initialStatusCelsius,
  toFahrenheit,
  getHandlerByIdentifier,
  createMockApiActions,
  createMockAPI
} from './testUtils.js';

// Mock AirConditionerAPI at the module level
jest.mock('../AirConditionerAPI.js', () => {
  return jest.fn();
}, { virtual: true });

// --- The Core Test Suite ---
describe('TfiacPlatformAccessory - Core', () => {
  let accessory: TfiacPlatformAccessory;
  let deviceConfig: TfiacDeviceConfig;
  let mockAccessoryInstance: PlatformAccessory;
  let mockServiceInstance: any;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockPlatform: TfiacPlatform;
  let mockApiActions: ReturnType<typeof createMockApiActions>;
  let mockAPI: ReturnType<typeof createMockAPI>;

  beforeAll(() => {
    jest.setTimeout(30000); // Increase timeout to 30 seconds for all tests in this suite
  });

  beforeEach(() => {
    jest.useFakeTimers();
    
    // Create fresh mock instances for each test
    mockLogger = createMockLogger();
    mockAPI = createMockAPI();
    mockPlatform = setupTestPlatform({}, mockLogger, mockAPI);
    mockServiceInstance = createMockService();
    mockApiActions = createMockApiActions({ ...initialStatusFahrenheit });
    
    // Set up AirConditionerAPI mock
    (AirConditionerAPI as jest.Mock).mockImplementation(() => mockApiActions);
    
    // Clear all mocks before each test
    Object.values(mockApiActions).forEach(mockFn => mockFn.mockClear());

    // Set up mock return values
    mockApiActions.updateState.mockResolvedValue({ ...initialStatusFahrenheit });
    mockApiActions.turnOn.mockResolvedValue(undefined);
    mockApiActions.turnOff.mockResolvedValue(undefined);
    mockApiActions.setAirConditionerState.mockResolvedValue(undefined);
    mockApiActions.setFanSpeed.mockResolvedValue(undefined);
    mockApiActions.setSwingMode.mockResolvedValue(undefined);
    mockApiActions.cleanup.mockResolvedValue(undefined);

    deviceConfig = { name: 'Test AC', ip: '192.168.1.99', port: 7777, updateInterval: 30 };
    mockServiceInstance.getCharacteristic.mockClear();
    mockServiceInstance.setCharacteristic.mockClear();
    mockServiceInstance.characteristics.clear();

    mockAccessoryInstance = {
      context: { deviceConfig },
      displayName: deviceConfig.name,
      UUID: 'test-accessory-uuid',
      category: Categories.AIR_CONDITIONER,
      getService: jest.fn((service) => {
        if (service === mockAPI.hap.Service.HeaterCooler) {
          return mockServiceInstance;
        }
        return null;
      }),
      addService: jest.fn((service, name) => {
        return mockServiceInstance;
      }),
      services: [mockServiceInstance as unknown],
      on: jest.fn(),
      emit: jest.fn(),
      removeService: jest.fn(),
      getServiceById: jest.fn(),
    } as unknown as PlatformAccessory;

    // Create the accessory - IMPORTANT: this needs to happen after the mocks are set up
    accessory = new TfiacPlatformAccessory(mockPlatform, mockAccessoryInstance);
    
    // Manually set deviceAPI to our mock to ensure API calls work
    (accessory as any).deviceAPI = mockApiActions;

    const testContext = accessory as unknown as {
      pollingInterval: NodeJS.Timeout | null;
      cachedStatus: AirConditionerStatus | null;
      deviceAPI?: { cleanup?: () => void };
      stopPolling?: () => void;
    };
    
    if (testContext.pollingInterval) {
      clearInterval(testContext.pollingInterval);
      testContext.pollingInterval = null;
    }
    testContext.cachedStatus = { ...initialStatusFahrenheit };
  });

  afterEach(() => {
    const testContext = accessory as unknown as {
      pollingInterval: NodeJS.Timeout | null;
      cachedStatus: AirConditionerStatus | null;
      deviceAPI?: { cleanup?: () => void };
      stopPolling?: () => void;
    };
    
    if (accessory && typeof testContext.stopPolling === 'function') {
      testContext.stopPolling();
    } else {
      mockApiActions.cleanup.mockClear();
    }
    jest.clearAllTimers();
    jest.clearAllMocks();
  });

  // --- Test Cases ---
  describe('Initialization', () => {
    it('should create AirConditionerAPI instance', () => {
      // Reset the mock completely
      (AirConditionerAPI as jest.Mock).mockClear();
      
      // Mock startPolling to avoid setting timers
      jest.spyOn(TfiacPlatformAccessory.prototype, 'startPolling').mockImplementation(function() {
        // Empty mock implementation that doesn't set intervals and doesn't access this.log
        return;
      });
      
      // Create a new instance to trigger the constructor call
      const testDeviceConfig = { name: 'Test AC', ip: '192.168.1.99', port: 7777, updateInterval: 30 };
      const testMockAccessoryInstance = {
        context: { deviceConfig: testDeviceConfig },
        displayName: testDeviceConfig.name,
        UUID: 'test-accessory-uuid',
        category: Categories.AIR_CONDITIONER,
        getService: jest.fn((service) => {
          if (service === mockAPI.hap.Service.HeaterCooler) {
            return mockServiceInstance;
          }
          return null;
        }),
        addService: jest.fn((service, name) => {
          return mockServiceInstance;
        }),
        services: [mockServiceInstance as unknown],
        on: jest.fn(),
        emit: jest.fn(),
        removeService: jest.fn(),
        getServiceById: jest.fn(),
      } as unknown as PlatformAccessory;
      accessory = new TfiacPlatformAccessory(mockPlatform, testMockAccessoryInstance);
      expect(AirConditionerAPI).toHaveBeenCalledWith(testDeviceConfig.ip, testDeviceConfig.port);
      
      // Clean up the spy
      (TfiacPlatformAccessory.prototype.startPolling as jest.SpyInstance).mockRestore();
    });
    
    // ... rest of the tests remain unchanged
  });

  // ... rest of the test suites remain unchanged
});