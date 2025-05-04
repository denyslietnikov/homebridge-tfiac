// Mock dependencies
import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest';
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

// Update the setDisplayState mock to correctly call setAirConditionerState
mockApiActions.setDisplayState.mockImplementation(function(state) {
  return mockApiActions.setAirConditionerState('opt_display', state);
});

// Fix the mock by using the default export format that Vitest expects
vi.mock('../AirConditionerAPI.js', () => ({
  default: vi.fn(() => mockApiActions)
}));

describe('DisplaySwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let mockService: ReturnType<typeof createMockService>;
  let inst: DisplaySwitchAccessory;

  beforeEach(() => {
    vi.clearAllMocks();
    
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

    // Correctly type the vi.fn mocks for service methods
    accessory.getService = vi.fn().mockReturnValue(undefined); // Use undefined instead of null
    accessory.getServiceById = vi.fn().mockReturnValue(undefined); // Use undefined instead of null
    // Cast mockService to satisfy the type checker for the mock return value
    accessory.addService = vi.fn().mockReturnValue(mockService as unknown as Service);
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

  it('should handle get with cached status', async () => {
    createAccessory();
    (inst as any).cachedStatus = { opt_display: 'on' };
    await (inst as any).handleGet((err: Error | null, val: boolean) => {
      expect(err).toBeNull();
      expect(val).toBe(true);
    });
  });

  it('should handle get with no cached status', async () => {
    createAccessory();
    (inst as any).cachedStatus = null;
    await (inst as any).handleGet((err: Error | null, val: boolean) => {
      expect(err).toBeNull();
      expect(val).toBe(false);
    });
  });

  it('should handle set and update status', async () => {
    createAccessory();
    const cb = vi.fn() as CharacteristicSetCallback;
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
    const cb = vi.fn() as CharacteristicSetCallback;
    await (inst as any).handleSet(true, cb);
    expect(mockApiActions.setDisplayState).toHaveBeenCalledWith('on');
    expect(cb).toHaveBeenCalledWith(error);
  });
});