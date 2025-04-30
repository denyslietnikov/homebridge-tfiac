// Mock dependencies
import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import { DisplaySwitchAccessory } from '../DisplaySwitchAccessory.js';
import { CharacteristicGetCallback, CharacteristicSetCallback, PlatformAccessory, Service } from 'homebridge';
import { TfiacPlatform } from '../platform.js';
import {
  createMockLogger,
  createMockService,
  createMockPlatformAccessory,
  createMockAPI,
  createMockApiActions, // Keep this import
  MockApiActions, // Import the type definition
} from './testUtils';

// Mock AirConditionerAPI with our utilities
const mockApiActions: MockApiActions = createMockApiActions({
  opt_display: 'on',
});

jest.mock('../AirConditionerAPI.js', () => {
  return jest.fn().mockImplementation(() => mockApiActions);
});

describe('DisplaySwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let mockService: ReturnType<typeof createMockService>;
  let inst: DisplaySwitchAccessory;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mocks using our utility functions
    mockService = createMockService();
    
    // Set up the platform with our mock utilities
    const mockAPI = createMockAPI();
    const mockLogger = createMockLogger();
    
    platform = {
      Service: { 
        Switch: { UUID: 'switch-uuid' },
      },
      Characteristic: {
        Name: 'Name',
        On: 'On',
        ConfiguredName: 'ConfiguredName',
      },
      log: mockLogger,
      api: mockAPI
    } as unknown as TfiacPlatform;
    
    // Create a mock accessory with our utility
    accessory = createMockPlatformAccessory(
      'Test Display Switch', 
      'uuid-display', 
      { name: 'Test AC', ip: '192.168.1.99', port: 7777, updateInterval: 1 },
      mockService
    );

    // Correctly type the jest.fn mocks for service methods
    accessory.getService = jest.fn<() => Service | undefined>().mockReturnValue(undefined); // Use undefined instead of null
    accessory.getServiceById = jest.fn<() => Service | undefined>().mockReturnValue(undefined); // Use undefined instead of null
    // Cast mockService to satisfy the type checker for the mock return value
    accessory.addService = jest.fn<() => Service>().mockReturnValue(mockService as unknown as Service);
  });

  afterEach(() => {
    if (inst) {
      inst.stopPolling();
    }
  });

  const createAccessory = () => {
    inst = new DisplaySwitchAccessory(platform, accessory);
    return inst;
  };

  it('should construct and set up polling and handlers', () => {
    createAccessory();
    expect(accessory.addService).toHaveBeenCalledWith(platform.Service.Switch, 'Display', 'display');
    // Name is now set in BaseSwitchAccessory constructor only
    expect(mockService.setCharacteristic).toHaveBeenCalledWith(platform.Characteristic.Name, 'Display');
    expect(mockService.getCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On);
  });

  it('should stop polling and cleanup', () => {
    createAccessory();
    inst.stopPolling();
    expect(mockApiActions.cleanup).toHaveBeenCalled();
  });

  it('should update cached status and update characteristic', async () => {
    createAccessory();
    mockApiActions.updateState.mockResolvedValueOnce({ opt_display: 'on' });
    await (inst as any).updateCachedStatus();
    expect(mockApiActions.updateState).toHaveBeenCalled();
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, true);
  });

  it('should handle get with cached status', done => {
    createAccessory();
    (inst as any).cachedStatus = { opt_display: 'on' };
    (inst as any).handleGet((err: Error | null, val: boolean) => {
      expect(err).toBeNull();
      expect(val).toBe(true);
      done();
    });
  });

  it('should handle get with no cached status', done => {
    createAccessory();
    (inst as any).cachedStatus = null;
    (inst as any).handleGet((err: Error | null, val: boolean) => {
      expect(err).toBeNull();
      expect(val).toBe(false);
      done();
    });
  });

  it('should handle set and update status', async () => {
    createAccessory();
    const cb = jest.fn() as CharacteristicSetCallback;
    mockApiActions.setDisplayState.mockResolvedValueOnce(undefined);
    await (inst as any).handleSet(true, cb);
    expect(mockApiActions.setDisplayState).toHaveBeenCalledWith('on');
    expect(cb).toHaveBeenCalledWith(null);
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, true);
  });

  it('should handle set error', async () => {
    createAccessory();
    const error = new Error('fail');
    mockApiActions.setDisplayState.mockRejectedValueOnce(error);
    const cb = jest.fn() as CharacteristicSetCallback;
    await (inst as any).handleSet(true, cb);
    expect(mockApiActions.setDisplayState).toHaveBeenCalledWith('on');
    expect(cb).toHaveBeenCalledWith(error);
  });
});