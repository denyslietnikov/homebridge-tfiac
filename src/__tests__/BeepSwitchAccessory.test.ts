import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest';
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

vi.mock('../AirConditionerAPI.js', () => ({
  default: vi.fn(() => mockApiActions)
}));

describe('BeepSwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let mockService: ReturnType<typeof createMockService>;
  let inst: BeepSwitchAccessory;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiActions.updateState.mockResolvedValue({ opt_beep: 'on' });

    mockService = createMockService();

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

    accessory.getService = vi.fn().mockReturnValue(undefined);
    accessory.getServiceById = vi.fn().mockReturnValue(undefined);
    accessory.addService = vi.fn().mockReturnValue(mockService as unknown as Service);
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
    expect(accessory.addService).toHaveBeenCalledWith(platform.Service.Switch, 'Beep', 'beep');
    expect(mockService.setCharacteristic).toHaveBeenCalledWith(platform.Characteristic.Name, 'Beep');
    expect(mockService.getCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On);
    const onChar = mockService.getCharacteristic(platform.Characteristic.On);
    expect(onChar.onGet).toHaveBeenCalledWith(expect.any(Function));
    expect(onChar.onSet).toHaveBeenCalledWith(expect.any(Function));
  });

  it('should stop polling and cleanup', () => {
    createAccessory();
    inst.stopPolling();
    expect(mockApiActions.cleanup).toHaveBeenCalled();
  });

  it('should update cached status and update characteristic', async () => {
    inst = new BeepSwitchAccessory(platform, accessory);
    mockService.updateCharacteristic.mockClear();
    (inst as any).cachedStatus = { opt_beep: 'off' };

    await (inst as any).updateCachedStatus();
    expect(mockApiActions.updateState).toHaveBeenCalled();
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, true);
  });

  // New get-handler tests using onGet API
  it('should handle get with cached status (beep on)', async () => {
    createAccessory();
    const onChar = mockService.getCharacteristic(platform.Characteristic.On);
    (inst as any).cachedStatus = { opt_beep: 'on' };
    const handler = onChar.onGet.mock.calls[0][0] as () => boolean;
    expect(await handler()).toBe(true);
  });

  it('should handle get with cached status (beep off)', async () => {
    createAccessory();
    const onChar = mockService.getCharacteristic(platform.Characteristic.On);
    (inst as any).cachedStatus = { opt_beep: 'off' };
    const handler = onChar.onGet.mock.calls[0][0] as () => boolean;
    expect(await handler()).toBe(false);
  });

  it('should handle get with no cached status', async () => {
    createAccessory();
    const onChar = mockService.getCharacteristic(platform.Characteristic.On);
    (inst as any).cachedStatus = null;
    const handler = onChar.onGet.mock.calls[0][0] as () => boolean;
    expect(await handler()).toBe(false);
  });

  it('should handle set (turn beep on) and update status', async () => {
    createAccessory();
    const onChar = mockService.getCharacteristic(platform.Characteristic.On);
    mockApiActions.setBeepState.mockResolvedValueOnce(undefined);
    const handler = onChar.onSet.mock.calls[0][0] as (value: boolean) => Promise<void>;
    await handler(true);
    expect(mockApiActions.setBeepState).toHaveBeenCalledWith('on');
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, true);
  });

  it('should handle set (turn beep off) and update status', async () => {
    createAccessory();
    const onChar = mockService.getCharacteristic(platform.Characteristic.On);
    mockApiActions.setBeepState.mockResolvedValueOnce(undefined);
    const handler = onChar.onSet.mock.calls[0][0] as (value: boolean) => Promise<void>;
    await handler(false);
    expect(mockApiActions.setBeepState).toHaveBeenCalledWith('off');
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, false);
  });

  it('should handle set error', async () => {
    createAccessory();
    const onChar = mockService.getCharacteristic(platform.Characteristic.On);
    const error = new Error('API Error');
    mockApiActions.setBeepState.mockRejectedValueOnce(error);
    const handler = onChar.onSet.mock.calls[0][0] as (value: boolean) => Promise<void>;
    await expect(handler(true)).rejects.toThrow(error);
    expect(mockService.updateCharacteristic).not.toHaveBeenCalledWith(platform.Characteristic.On, true);
  });
});