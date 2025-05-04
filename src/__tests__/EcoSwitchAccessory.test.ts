import { vi, it, expect, describe, beforeEach, afterEach } from 'vitest';
import { PlatformAccessory } from 'homebridge';
import { PowerState } from '../enums.js'; // Import Enum

// Mock CacheManager
vi.mock('../CacheManager.js', () => {
  const clearCache = vi.fn();
  const updateState = vi.fn();
  const setEcoState = vi.fn();
  const instance = {
    startPolling: vi.fn(),
    stopPolling: vi.fn(),
    clear: clearCache,
    api: { updateState, setEcoState, on: vi.fn(), off: vi.fn() },
    cleanup: vi.fn(),
    getStatus: vi.fn().mockResolvedValue({ opt_eco: PowerState.Off }),
  };
  return {
    default: {
      CacheManager: {
        getInstance: vi.fn().mockReturnValue(instance),
      },
    },
    CacheManager: {
      getInstance: vi.fn().mockReturnValue(instance),
    },
    __spies: { clearCache, updateState, setEcoState },
  };
});

// Import dependencies after the mocks to avoid hoisting issues
import { EcoSwitchAccessory } from '../EcoSwitchAccessory.js';
import { TfiacPlatform } from '../platform.js';

import * as CM from '../CacheManager.js';
const { clearCache, updateState, setEcoState } = (CM as any).__spies;

// Mock service builder
const mockService = {
  setCharacteristic: vi.fn().mockReturnThis(),
  getCharacteristic: vi.fn().mockReturnValue({
    on: vi.fn().mockReturnThis(),
    value: null,
  }),
  updateCharacteristic: vi.fn(),
};

// Create an instance for reuse
const createEcoSwitchInstance = () => {
  const instance = new EcoSwitchAccessory({
    log: { debug: vi.fn(), info: vi.fn(), error: vi.fn() },
    Service: { Switch: vi.fn() },
    Characteristic: { Name: 'Name', On: 'On' },
    config: {
      devices: [{ 
        ip: '1.2.3.4', 
        name: 'AC', 
        pollInterval: 30,
        updateInterval: 30,
      }]
    }
  } as unknown as TfiacPlatform, {
    context: { deviceConfig: { name: 'AC', ip: '1.2.3.4', updateInterval: 1 } },
    getService: vi.fn().mockReturnValue(null),
    addService: vi.fn().mockReturnValue(mockService),
    getServiceById: vi.fn(),
  } as unknown as PlatformAccessory);
  
  // Ensure cacheManager.api is properly set up for tests
  (instance as any).cacheManager = {
    api: { 
      setEcoState, 
      updateState, 
      on: vi.fn(), 
      off: vi.fn() 
    },
    clear: clearCache,
    getStatus: vi.fn().mockResolvedValue({ opt_eco: PowerState.Off }),
    cleanup: vi.fn(),
  };
  
  return instance;
};

// --------------------------------------------------------------------

describe('EcoSwitchAccessory – unit', () => {
  let accessory: EcoSwitchAccessory;
  let inst: any; // Instance tracker

  beforeEach(() => {
    vi.clearAllMocks();
    updateState.mockResolvedValue({ opt_eco: PowerState.Off });
    setEcoState.mockResolvedValue({});

    // Reset mockService.updateCharacteristic before each test
    mockService.updateCharacteristic.mockClear();
  });

  afterEach(() => {
    if (inst) {
      inst.stopPolling();
    }
  });

  it('initializes correctly', () => {
    inst = createEcoSwitchInstance();
    expect(mockService.setCharacteristic).toHaveBeenCalledWith('Name', 'Eco');
  });

  it('updates status from eco off to on', () => {
    inst = createEcoSwitchInstance();
    
    inst['updateStatus']({ opt_eco: PowerState.Off });
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith('On', false);
    
    mockService.updateCharacteristic.mockClear();
    
    inst['updateStatus']({ opt_eco: PowerState.On });
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith('On', true);
  });

  it('handles missing eco status', () => {
    inst = createEcoSwitchInstance();
    inst['updateStatus']({});
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith('On', false);
  });

  it('sets eco state on when true is passed', async () => {
    inst = createEcoSwitchInstance();
    await inst['setEcoState'](true);
    expect(setEcoState).toHaveBeenCalledWith(PowerState.On);
    expect(clearCache).toHaveBeenCalled();
  });

  it('sets eco state off when false is passed', async () => {
    inst = createEcoSwitchInstance();
    await inst['setEcoState'](false);
    expect(setEcoState).toHaveBeenCalledWith(PowerState.Off);
    expect(clearCache).toHaveBeenCalled();
  });

  it('handles error when setting eco state', async () => {
    inst = createEcoSwitchInstance();
    const error = new Error('Test error');
    setEcoState.mockRejectedValueOnce(error);
    
    await expect(inst['setEcoState'](true)).rejects.toThrow('Test error');
    expect(clearCache).not.toHaveBeenCalled();
  });
});