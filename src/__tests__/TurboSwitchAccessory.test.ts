import { TurboSwitchAccessory } from '../TurboSwitchAccessory.js';
import { TfiacPlatform } from '../platform.js';
import { PlatformAccessory } from 'homebridge';
import CacheManager from '../CacheManager.js';
import { PowerState } from '../enums.js';

// Mock the CacheManager
jest.mock('../CacheManager.js');

describe('TurboSwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let service: any;
  let inst: TurboSwitchAccessory;
  
  // Mock cache manager with API methods
  const mockCacheManager = {
    api: {
      setTurboState: jest.fn().mockResolvedValue(undefined),
      updateState: jest.fn().mockResolvedValue({}),
    },
    get: jest.fn(),
    set: jest.fn(),
    clear: jest.fn(),
    startPolling: jest.fn(),
    stopPolling: jest.fn(),
    cleanup: jest.fn(),
  };

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock the CacheManager constructor to return our mock
    (CacheManager as unknown as jest.Mock).mockImplementation(() => mockCacheManager);
    // Ensure BaseSwitchAccessory uses our mockCacheManager via getInstance
    /** @ts-ignore */
    (CacheManager as unknown as any).getInstance = (_config: any) => mockCacheManager;

    // Create platform mock
    platform = {
      log: {
        info: jest.fn(),
        debug: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
      },
      api: {
        hap: {
          uuid: {
            generate: jest.fn().mockReturnValue('mock-uuid'),
          },
        },
        platformAccessory: jest.fn(),
      },
      Service: {
        Switch: jest.fn(),
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
      getService: jest.fn().mockReturnValue(null),
      getServiceById: jest.fn().mockReturnValue(null),
      addService: jest.fn().mockImplementation(() => service),
      removeService: jest.fn(),
      on: jest.fn(),
      emit: jest.fn(),
    } as unknown as PlatformAccessory;

    // Create service mock
    service = {
      getCharacteristic: jest.fn().mockReturnValue({
        on: jest.fn().mockReturnThis(),
        updateValue: jest.fn(),
      }),
      setCharacteristic: jest.fn().mockReturnThis(),
      updateCharacteristic: jest.fn(),
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

  it('handles get characteristic with turbo on', () => {
    const callback = jest.fn();
    // Use the correct property name 'opt_turbo' and Enum value
    (inst as any).cachedStatus = { opt_turbo: PowerState.On };
    (inst as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it('handles get characteristic with turbo off', () => {
    const callback = jest.fn();
    // Use the correct property name 'opt_turbo' and Enum value
    (inst as any).cachedStatus = { opt_turbo: PowerState.Off };
    (inst as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it('handles get characteristic with null status', () => {
    const callback = jest.fn();
    (inst as any).cachedStatus = null;
    (inst as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, false);
  });

  it('handles set characteristic to turn turbo on', async () => {
    const callback = jest.fn();
    await (inst as any).handleSet(true, callback);
    expect(mockCacheManager.api.setTurboState).toHaveBeenCalledWith(PowerState.On);
    expect(mockCacheManager.clear).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(null);
  });

  it('handles set characteristic to turn turbo off', async () => {
    const callback = jest.fn();
    await (inst as any).handleSet(false, callback);
    expect(mockCacheManager.api.setTurboState).toHaveBeenCalledWith(PowerState.Off);
    expect(mockCacheManager.clear).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(null);
  });

  it('handles set error', async () => {
    const callback = jest.fn();
    const error = new Error('API error');
    mockCacheManager.api.setTurboState.mockRejectedValueOnce(error);
    await (inst as any).handleSet(true, callback);
    expect(mockCacheManager.api.setTurboState).toHaveBeenCalledWith(PowerState.On);
    expect(mockCacheManager.clear).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(error);
  });

  it('handles get characteristic with null cached status', () => {
    const callback = jest.fn(); // Define the callback variable
    (inst as any).cachedStatus = null;
    (inst as any).handleGet(callback);
    expect(callback).toHaveBeenCalledWith(null, false);
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