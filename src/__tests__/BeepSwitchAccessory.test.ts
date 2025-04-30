import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import { BeepSwitchAccessory } from '../BeepSwitchAccessory.js';
import { CharacteristicGetCallback, CharacteristicSetCallback, PlatformAccessory, Service } from 'homebridge';
import { TfiacPlatform } from '../platform.js';
import {
  createMockLogger,
  createMockService,
  createMockPlatformAccessory,
  createMockAPI,
  createMockApiActions,
  MockApiActions,
} from './testUtils.js';

const mockApiActions: MockApiActions = createMockApiActions({
  opt_beep: 'on',
});

jest.mock('../AirConditionerAPI.js', () => {
  return jest.fn().mockImplementation(() => mockApiActions);
});

describe('BeepSwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let mockService: ReturnType<typeof createMockService>;
  let mockOnCharacteristic: { onGet: jest.Mock; onSet: jest.Mock; on: jest.Mock; updateValue: jest.Mock };
  let inst: BeepSwitchAccessory;

  beforeEach(() => {
    jest.clearAllMocks();

    mockService = createMockService();
    mockOnCharacteristic = {
      onGet: jest.fn().mockReturnThis(),
      onSet: jest.fn().mockReturnThis(),
      on: jest.fn().mockReturnThis(), // Add the on method for legacy API compatibility
      updateValue: jest.fn().mockReturnThis(), // Add updateValue method to fix test errors
    };
    mockService.getCharacteristic.mockImplementation((characteristic: any) => {
      // Handle both the characteristic class/constructor and its potential string representation ('On')
      if (characteristic === platform.Characteristic.On || characteristic === 'On') {
        return mockOnCharacteristic;
      }
      // Return a generic mock for other characteristics like Name, ConfiguredName etc.
      return {
        onGet: jest.fn().mockReturnThis(),
        onSet: jest.fn().mockReturnThis(),
        on: jest.fn().mockReturnThis(), // Add the on method for legacy API compatibility
        updateValue: jest.fn().mockReturnThis(),
      };
    });

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
      api: mockAPI,
    } as unknown as TfiacPlatform;

    accessory = createMockPlatformAccessory(
      'Test Beep Switch',
      'uuid-beep',
      { name: 'Test AC', ip: '192.168.1.100', port: 7777, updateInterval: 1 },
      mockService,
    );

    accessory.getService = jest.fn<() => Service | undefined>().mockReturnValue(undefined);
    accessory.getServiceById = jest.fn<() => Service | undefined>().mockReturnValue(undefined);
    accessory.addService = jest.fn<() => Service>().mockReturnValue(mockService as unknown as Service);
  });

  afterEach(() => {
    if (inst) {
      inst.stopPolling();
    }
  });

  const createAccessory = () => {
    inst = new BeepSwitchAccessory(platform, accessory);
    return inst;
  };

  it('should construct and set up polling and handlers', () => {
    createAccessory();
    // getService is called with "Beep" in BaseSwitchAccessory.constructor
    expect(accessory.addService).toHaveBeenCalledWith(platform.Service.Switch, 'Beep', 'beep');
    // Name is now set in BaseSwitchAccessory constructor only
    expect(mockService.setCharacteristic).toHaveBeenCalledWith(platform.Characteristic.Name, 'Beep');
    expect(mockService.getCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On);
    expect(mockOnCharacteristic.on).toHaveBeenCalledWith('get', expect.any(Function));
    expect(mockOnCharacteristic.on).toHaveBeenCalledWith('set', expect.any(Function));
  });

  it('should stop polling and cleanup', () => {
    createAccessory();
    inst.stopPolling();
    expect(mockApiActions.cleanup).toHaveBeenCalled();
  });

  it('should update cached status and update characteristic', async () => {
    inst = new BeepSwitchAccessory(platform, accessory);
    // Clear mocks specifically for updateCharacteristic after constructor might have called it
    mockService.updateCharacteristic.mockClear();
    (inst as any).cachedStatus = { opt_beep: 'off' }; // Set initial different state

    await (inst as any).updateCachedStatus();
    expect(mockApiActions.updateState).toHaveBeenCalled();
    // Expect 'On' characteristic to be updated to 'true' because mockApiActions has opt_beep: 'on'
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, true);
  });

  it('should handle get with cached status (beep on)', done => {
    createAccessory();
    (inst as any).cachedStatus = { opt_beep: 'on' };
    (inst as any).handleGet((err: Error | null, val?: boolean) => {
      expect(err).toBeNull();
      expect(val).toBe(true);
      done();
    });
  });

  it('should handle get with cached status (beep off)', done => {
    createAccessory();
    (inst as any).cachedStatus = { opt_beep: 'off' };
    (inst as any).handleGet((err: Error | null, val?: boolean) => {
      expect(err).toBeNull();
      expect(val).toBe(false);
      done();
    });
  });

  it('should handle get with no cached status', done => {
    createAccessory();
    (inst as any).cachedStatus = null;
    (inst as any).handleGet((err: Error | null, val?: boolean) => {
      expect(err).toBeNull();
      expect(val).toBe(false);
      done();
    });
  });

  it('should handle set (turn beep on) and update status', async () => {
    createAccessory();
    const cb = jest.fn() as CharacteristicSetCallback;
    mockApiActions.setBeepState.mockResolvedValueOnce(undefined);
    await (inst as any).handleSet(true, cb);
    expect(mockApiActions.setBeepState).toHaveBeenCalledWith('on');
    expect(cb).toHaveBeenCalledWith(null);
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, true);
  });

  it('should handle set (turn beep off) and update status', async () => {
    createAccessory();
    const cb = jest.fn() as CharacteristicSetCallback;
    mockApiActions.setBeepState.mockResolvedValueOnce(undefined);
    await (inst as any).handleSet(false, cb);
    expect(mockApiActions.setBeepState).toHaveBeenCalledWith('off');
    expect(cb).toHaveBeenCalledWith(null);
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, false);
  });

  it('should handle set error', async () => {
    createAccessory();
    const error = new Error('API Error');
    mockApiActions.setBeepState.mockRejectedValueOnce(error);
    const cb = jest.fn() as CharacteristicSetCallback;
    await (inst as any).handleSet(true, cb);
    expect(mockApiActions.setBeepState).toHaveBeenCalledWith('on');
    expect(cb).toHaveBeenCalledWith(error);
    expect(mockService.updateCharacteristic).not.toHaveBeenCalledWith(platform.Characteristic.On, true);
  });
});