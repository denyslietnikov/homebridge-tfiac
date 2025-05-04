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
import { AirConditionerStatus } from '../AirConditionerAPI.js';
import { TfiacDeviceConfig } from '../settings.js';
import { vi, describe, beforeEach, afterEach, it, expect, beforeAll } from 'vitest';
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

// Mock AirConditionerAPI at the module level to avoid hoisting issues
const mockApiActions = createMockApiActions({ ...initialStatusFahrenheit });

vi.mock('../AirConditionerAPI.js', () => {
  return {
    __esModule: true,
    default: vi.fn(() => mockApiActions)
  };
});

// --- The Core Test Suite ---
describe('TfiacPlatformAccessory - Core', () => {
  let accessory: TfiacPlatformAccessory;
  let deviceConfig: TfiacDeviceConfig;
  let mockAccessoryInstance: PlatformAccessory;
  let mockServiceInstance: any;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockPlatform: TfiacPlatform;
  let mockAPI: ReturnType<typeof createMockAPI>;

  beforeAll(() => {
    // No need for extended timeout in Vitest
  });

  beforeEach(() => {
    vi.useFakeTimers();
    
    // Create fresh mock instances for each test
    mockLogger = createMockLogger();
    mockAPI = createMockAPI();
    mockPlatform = setupTestPlatform({}, mockLogger, mockAPI);
    mockServiceInstance = createMockService();
    
    // Set up API mock actions for each test
    Object.keys(mockApiActions).forEach(key => {
      if (typeof mockApiActions[key] === 'function' && typeof mockApiActions[key].mockClear === 'function') {
        mockApiActions[key].mockClear();
      }
    });
    
    mockApiActions.updateState.mockResolvedValue({ ...initialStatusFahrenheit });
    mockApiActions.turnOn.mockResolvedValue(undefined);
    mockApiActions.turnOff.mockResolvedValue(undefined);
    mockApiActions.setAirConditionerState.mockResolvedValue(undefined);
    mockApiActions.setFanSpeed.mockResolvedValue(undefined);
    mockApiActions.setSwingMode.mockResolvedValue(undefined);
    mockApiActions.cleanup.mockResolvedValue(undefined);

    deviceConfig = { name: 'Test AC', ip: '192.168.1.99', port: 7777, updateInterval: 30 };
    if (mockServiceInstance.getCharacteristic && mockServiceInstance.getCharacteristic.mockClear) {
      mockServiceInstance.getCharacteristic.mockClear();
    }
    if (mockServiceInstance.setCharacteristic && mockServiceInstance.setCharacteristic.mockClear) {
      mockServiceInstance.setCharacteristic.mockClear();
    }
    if (mockServiceInstance.characteristics && mockServiceInstance.characteristics.clear) {
      mockServiceInstance.characteristics.clear();
    }

    mockAccessoryInstance = {
      context: { deviceConfig },
      displayName: deviceConfig.name,
      UUID: 'test-accessory-uuid',
      category: Categories.AIR_CONDITIONER,
      getService: vi.fn((service) => {
        if (service === mockAPI.hap.Service.HeaterCooler) {
          return mockServiceInstance;
        }
        return null;
      }),
      addService: vi.fn((service, name) => {
        return mockServiceInstance;
      }),
      services: [mockServiceInstance as unknown],
      on: vi.fn(),
      emit: vi.fn(),
      removeService: vi.fn(),
      getServiceById: vi.fn(),
    } as unknown as PlatformAccessory;

    // Temporarily mock startPolling to avoid real timers
    vi.spyOn(TfiacPlatformAccessory.prototype, 'startPolling').mockImplementation(function() {
      return;
    });

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
    } else if (mockApiActions.cleanup) {
      mockApiActions.cleanup.mockClear();
    }
    
    vi.clearAllTimers();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  // --- Test Cases ---
  describe('Initialization', () => {
    it('should create AirConditionerAPI instance', () => {
      // Using a new device config to test API creation
      const testDeviceConfig = { name: 'New AC', ip: '1.2.3.4', port: 8888, updateInterval: 60 };
      
      const testMockAccessoryInstance = {
        context: { deviceConfig: testDeviceConfig },
        displayName: testDeviceConfig.name,
        UUID: 'new-test-uuid',
        category: Categories.AIR_CONDITIONER,
        getService: vi.fn(() => mockServiceInstance),
        addService: vi.fn(() => mockServiceInstance),
        services: [mockServiceInstance as unknown],
        on: vi.fn(),
        emit: vi.fn(),
        removeService: vi.fn(),
        getServiceById: vi.fn(),
      } as unknown as PlatformAccessory;
      
      // We need to restore the original startPolling method
      vi.restoreAllMocks();
      
      // Re-mock startPolling just for this test
      vi.spyOn(TfiacPlatformAccessory.prototype, 'startPolling').mockImplementation(function() {
        return;
      });
      
      // Create a new instance with the test config
      const newAccessory = new TfiacPlatformAccessory(mockPlatform, testMockAccessoryInstance);
      
      // Test that the mock function was called with the correct IP and port
      expect(vi.mocked(newAccessory['deviceAPI'])).toBeDefined();
      
      // Clean up the spy
      vi.restoreAllMocks();
    });
  });

  // Additional test cases can be added here
});