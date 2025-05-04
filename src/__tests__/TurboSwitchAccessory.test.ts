import { vi, it, expect, describe, beforeEach, afterEach } from 'vitest';
import { TurboSwitchAccessory } from '../TurboSwitchAccessory.js';
import { TfiacPlatform } from '../platform.js';
import { PlatformAccessory } from 'homebridge';
import CacheManager from '../CacheManager.js';
import { PowerState } from '../enums.js';

// Mock the CacheManager
vi.mock('../CacheManager.js');

describe('TurboSwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let service: any;
  let inst: TurboSwitchAccessory;
  
  // Mock cache manager with API methods
  const mockCacheManager = {
    api: {
      setTurboState: vi.fn().mockResolvedValue(undefined),
      updateState: vi.fn().mockResolvedValue({}),
    },
    get: vi.fn(),
    set: vi.fn(),
    clear: vi.fn(),
    startPolling: vi.fn(),
    stopPolling: vi.fn(),
    cleanup: vi.fn(),
  };

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Mock the CacheManager constructor to return our mock
    (CacheManager as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockCacheManager);
    // Ensure BaseSwitchAccessory uses our mockCacheManager via getInstance
    /** @ts-ignore */
    (CacheManager as unknown as any).getInstance = (_config: any) => mockCacheManager;

    // Create platform mock
    platform = {
      log: {
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      },
      api: {
        hap: {
          uuid: {
            generate: vi.fn().mockReturnValue('mock-uuid'),
          },
        },
        platformAccessory: vi.fn(),
      },
      Service: {
        Switch: vi.fn(),
      },
      Characteristic: {
        On: 'On',
        Name: 'Name',
      },
      config: {
        devices: [
          {
            ip: '127.0.0.1',
            mac: 'AA:BB:CC:DD:EE:FF',
            pollInterval: 30,
            updateInterval: 30,
          },
        ],
      },
    } as unknown as TfiacPlatform;

    // Create accessory mock
    accessory = {
      displayName: 'Test Accessory',
      UUID: 'test-uuid',
      context: {
        deviceConfig: {
          ip: '127.0.0.1',
          mac: 'AA:BB:CC:DD:EE:FF',
          pollInterval: 30,
          updateInterval: 30,
        }
      },
      services: [],
      getService: vi.fn().mockReturnValue(null),
      getServiceById: vi.fn().mockReturnValue(null),
      addService: vi.fn().mockImplementation(() => service),
      removeService: vi.fn(),
      on: vi.fn(),
      emit: vi.fn(),
    } as unknown as PlatformAccessory;

    // Create service mock
    service = {
      getCharacteristic: vi.fn().mockReturnValue({
        on: vi.fn().mockReturnThis(),
        updateValue: vi.fn(),
      }),
      setCharacteristic: vi.fn().mockReturnThis(),
      updateCharacteristic: vi.fn(),
    };
    
    // Create instance of the accessory
    inst = new TurboSwitchAccessory(platform, accessory);
    
    // Ensure the mock cache manager is accessible in the instance
    (inst as any).cacheManager = mockCacheManager;
  });

  it('should initialize correctly', () => {
    expect(accessory.getServiceById).toHaveBeenCalled();
    expect(accessory.addService).toHaveBeenCalled();
    expect(service.setCharacteristic).toHaveBeenCalledWith('Name', 'Turbo');
    
    // Need to verify getCharacteristic calls with right parameter
    expect(service.getCharacteristic).toHaveBeenCalledWith('On');
    
    // Need to mock the on() method to verify handlers are set
    const onMethod = service.getCharacteristic('On').on;
    expect(onMethod).toHaveBeenCalledWith('get', expect.any(Function));
    expect(onMethod).toHaveBeenCalledWith('set', expect.any(Function));
  });

  it('handles get characteristic with turbo on', async () => {
    (inst as any).cachedStatus = { opt_turbo: PowerState.On };
    const value = await (inst as any).handleGet();
    expect(value).toBe(true);
  });

  it('handles get characteristic with turbo off', async () => {
    (inst as any).cachedStatus = { opt_turbo: PowerState.Off };
    const value = await (inst as any).handleGet();
    expect(value).toBe(false);
  });

  it('handles get characteristic with null status', async () => {
    (inst as any).cachedStatus = null;
    const value = await (inst as any).handleGet();
    expect(value).toBe(false);
  });

  it('handles set characteristic to turn turbo on', async () => {
    const callback = vi.fn();
    await (inst as any).handleSet(true, callback);
    expect(mockCacheManager.api.setTurboState).toHaveBeenCalledWith(PowerState.On);
    expect(mockCacheManager.clear).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(null);
  });

  it('handles set characteristic to turn turbo off', async () => {
    const callback = vi.fn();
    await (inst as any).handleSet(false, callback);
    expect(mockCacheManager.api.setTurboState).toHaveBeenCalledWith(PowerState.Off);
    expect(mockCacheManager.clear).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(null);
  });

  it('handles set error', async () => {
    const callback = vi.fn();
    const error = new Error('API error');
    mockCacheManager.api.setTurboState.mockRejectedValueOnce(error);
    await (inst as any).handleSet(true, callback);
    expect(mockCacheManager.api.setTurboState).toHaveBeenCalledWith(PowerState.On);
    expect(mockCacheManager.clear).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(error);
  });

  it('handles get characteristic with null cached status', async () => {
    (inst as any).cachedStatus = null;
    const value = await (inst as any).handleGet();
    expect(value).toBe(false);
  });

  it('should updateStatus and update On characteristic when turbo state changes', () => {
    inst = new TurboSwitchAccessory(platform, accessory);
    // simulate status event
    inst['updateStatus']({ opt_turbo: PowerState.On } as any);
    expect(service.updateCharacteristic).toHaveBeenCalledWith(
      'On',
      true,
    );
  });

  it('stops polling and cleans up api', () => {
    inst.stopPolling();
    expect(mockCacheManager.cleanup).toHaveBeenCalled();
  });
});