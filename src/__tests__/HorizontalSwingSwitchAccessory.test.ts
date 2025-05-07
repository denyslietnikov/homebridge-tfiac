import { vi, it, expect, describe, beforeEach } from 'vitest';
import { HorizontalSwingSwitchAccessory } from '../HorizontalSwingSwitchAccessory.js';
import { PlatformAccessory } from 'homebridge';
import { TfiacPlatform } from '../platform.js';
import { SwingMode } from '../enums.js';
import { createMockApiActions, createMockCacheManager } from './testUtils';

// Mock CacheManager module
vi.mock('../CacheManager.js', () => {
  const mockCacheManager = {
    getInstance: vi.fn(),
    api: {
      on: vi.fn(),
      off: vi.fn(),
    },
    getStatus: vi.fn(),
    getLastStatus: vi.fn(),
    clear: vi.fn(),
    cleanup: vi.fn(),
  };
  
  return {
    default: {
      getInstance: vi.fn().mockReturnValue(mockCacheManager),
    },
    CacheManager: {
      getInstance: vi.fn().mockReturnValue(mockCacheManager),
    },
    __esModule: true,
  };
});

describe('HorizontalSwingSwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: any;
  let service: any;
  let inst: HorizontalSwingSwitchAccessory;
  let deviceAPI: any;
  let setSwingModeMock: any;
  let mockCacheManager: any;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Create platform mock
    platform = {
      log: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      api: {
        hap: {
          Service: {
            Switch: { UUID: 'switch-uuid' },
          },
          Characteristic: {
            On: 'On',
            Name: 'Name',
          },
        },
      },
      Service: {
        Switch: { UUID: 'switch-uuid' },
      },
      Characteristic: {
        On: 'On',
        Name: 'Name',
        ConfiguredName: 'ConfiguredName',
      },
    } as any;

    // Create mock service
    service = {
      setCharacteristic: vi.fn().mockReturnThis(),
      getCharacteristic: vi.fn().mockReturnValue({
        on: vi.fn(),
        onGet: vi.fn(),
        onSet: vi.fn(),
        value: false,
      }),
      updateCharacteristic: vi.fn(),
    };

    // Create mock accessory
    accessory = {
      getService: vi.fn().mockReturnValue(null), // Return null to force addService call
      getServiceById: vi.fn().mockReturnValue(null), // Return null to force addService call
      addService: vi.fn().mockReturnValue(service),
      context: {
        deviceConfig: {
          ip: '192.168.1.100',
          port: 8080,
          name: 'Test AC',
        },
      },
      displayName: 'Test AC',
      services: [service],
    };

    // Create API mock with swing methods
    setSwingModeMock = vi.fn().mockResolvedValue(undefined);
    deviceAPI = createMockApiActions({ swing_mode: SwingMode.Off });
    deviceAPI.setSwingMode = setSwingModeMock;
    
    // Create mock CacheManager
    mockCacheManager = createMockCacheManager(deviceAPI, { swing_mode: SwingMode.Off });
    // No subscription capture needed; tests will call updateStatus directly
  });

  function createAccessory() {
    inst = new HorizontalSwingSwitchAccessory(platform, accessory);
    // Override CacheManager to use our mock
    (inst as any).cacheManager = mockCacheManager;
    // Set onChar to make tests simpler
    (inst as any).onChar = 'On';
    return inst;
  }

  it('should construct and set up polling and handlers', () => {
    createAccessory();
    expect(accessory.addService).toHaveBeenCalledWith(
      platform.Service.Switch,
      'Horizontal Swing',
      'horizontal_swing'
    );
    expect(service.setCharacteristic).toHaveBeenCalledWith(platform.Characteristic.Name, 'Horizontal Swing');
    expect(service.getCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On);
  });

  it('should stop polling and cleanup', () => {
    createAccessory();
    inst.stopPolling();
    expect(mockCacheManager.cleanup).toHaveBeenCalled();
  });

  it('should update cached status and update characteristic for Horizontal mode', async () => {
    createAccessory();
    // Simulate status event
    inst.updateStatus({ swing_mode: SwingMode.Horizontal });
    
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', true);
  });

  it('should update cached status and update characteristic for Both mode', async () => {
    createAccessory();
    inst.updateStatus({ swing_mode: SwingMode.Both });
    
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', true);
  });

  it('should handle error during update cached status', async () => {
    createAccessory();
    const error = new Error('Network error');
    
    // Simulate null status
    inst.updateStatus(null);
    
    expect(platform.log.error).not.toHaveBeenCalled();
  });

  // Tests for the real handleGet method
  describe('handleGet method', () => {
    it('should return true when cached status is Horizontal', () => {
      createAccessory();
      const callback = vi.fn();
      inst.updateStatus({ swing_mode: SwingMode.Horizontal });
      
      const result = inst['handleGet'](callback);
      
      expect(result).toBe(true);
      expect(callback).toHaveBeenCalledWith(null, true);
    });
    
    it('should return true when cached status is Both', () => {
      createAccessory();
      const callback = vi.fn();
      inst.updateStatus({ swing_mode: SwingMode.Both });
      
      const result = inst['handleGet'](callback);
      
      expect(result).toBe(true);
      expect(callback).toHaveBeenCalledWith(null, true);
    });
    
    it('should return false when cached status is Off', () => {
      createAccessory();
      const callback = vi.fn();
      inst.updateStatus({ swing_mode: SwingMode.Off });
      
      const result = inst['handleGet'](callback);
      
      expect(result).toBe(false);
      expect(callback).toHaveBeenCalledWith(null, false);
    });
    
    it('should return false when cached status is Vertical', () => {
      createAccessory();
      const callback = vi.fn();
      inst.updateStatus({ swing_mode: SwingMode.Vertical });
      
      const result = inst['handleGet'](callback);
      
      expect(result).toBe(false);
      expect(callback).toHaveBeenCalledWith(null, false);
    });
    
    it('should return false when there is no cached status', () => {
      createAccessory();
      const callback = vi.fn();
      (inst as any).cachedStatus = null;
      
      const result = inst['handleGet'](callback);
      
      expect(result).toBe(false);
      expect(callback).toHaveBeenCalledWith(null, false);
    });
    
    it('should handle the case when no callback is provided', () => {
      createAccessory();
      inst.updateStatus({ swing_mode: SwingMode.Horizontal });
      
      const result = inst['handleGet']();
      
      expect(result).toBe(true);
    });
  });

  // Tests for the real handleSet method
  describe('handleSet method', () => {
    it('should set to Horizontal when turning ON with Off mode', async () => {
      createAccessory();
      const callback = vi.fn();
      inst.cachedStatus = { swing_mode: SwingMode.Off };
      
      await inst['handleSet'](true, callback);
      
      expect(mockCacheManager.api.setSwingMode).toHaveBeenCalledWith(SwingMode.Horizontal);
      expect(service.updateCharacteristic).toHaveBeenCalledWith('On', true);
      expect(mockCacheManager.clear).not.toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith(null);
    });
    
    it('should set to Both when turning ON with Vertical mode', async () => {
      createAccessory();
      const callback = vi.fn();
      inst.cachedStatus = { swing_mode: SwingMode.Vertical };
      
      await inst['handleSet'](true, callback);
      
      expect(mockCacheManager.api.setSwingMode).toHaveBeenCalledWith(SwingMode.Both);
      expect(callback).toHaveBeenCalledWith(null);
    });
    
    it('should set to Vertical when turning OFF with Both mode', async () => {
      createAccessory();
      const callback = vi.fn();
      inst.cachedStatus = { swing_mode: SwingMode.Both };
      
      await inst['handleSet'](false, callback);
      
      expect(mockCacheManager.api.setSwingMode).toHaveBeenCalledWith(SwingMode.Vertical);
      expect(callback).toHaveBeenCalledWith(null);
    });
    
    it('should set to Off when turning OFF with Horizontal mode', async () => {
      createAccessory();
      const callback = vi.fn();
      inst.cachedStatus = { swing_mode: SwingMode.Horizontal };
      
      await inst['handleSet'](false, callback);
      
      expect(mockCacheManager.api.setSwingMode).toHaveBeenCalledWith(SwingMode.Off);
      expect(callback).toHaveBeenCalledWith(null);
    });
    
    it('should fetch current status when no cached status exists', async () => {
      createAccessory();
      const callback = vi.fn();
      (inst as any).cachedStatus = null;
      mockCacheManager.getStatus.mockResolvedValueOnce({ swing_mode: SwingMode.Off });
      
      await inst['handleSet'](true, callback);
      
      expect(mockCacheManager.getStatus).toHaveBeenCalled();
      expect(mockCacheManager.api.setSwingMode).toHaveBeenCalledWith(SwingMode.Horizontal);
      expect(callback).toHaveBeenCalledWith(null);
    });
    
    it('should handle error when status fetch fails and callback exists', async () => {
      createAccessory();
      const callback = vi.fn();
      (inst as any).cachedStatus = null;
      const error = new Error('Could not retrieve status');
      mockCacheManager.getStatus.mockRejectedValueOnce(error);
      
      await inst['handleSet'](true, callback);
      
      expect(platform.log.error).toHaveBeenCalledWith(expect.stringContaining('Error setting Horizontal Swing'), error);
      expect(callback).toHaveBeenCalledWith(error);
    });
    
    it('should handle API errors when setting swing mode', async () => {
      createAccessory();
      const callback = vi.fn();
      const error = new Error('API error');
      inst.cachedStatus = { swing_mode: SwingMode.Off };
      mockCacheManager.api.setSwingMode.mockRejectedValueOnce(error);
      
      await inst['handleSet'](true, callback);
      
      expect(platform.log.error).toHaveBeenCalledWith(
        expect.stringContaining('Error setting Horizontal Swing'),
        error
      );
      expect(callback).toHaveBeenCalledWith(error);
    });
    
    it('should handle case when service is not found', async () => {
      createAccessory();
      const callback = vi.fn();
      inst.cachedStatus = { swing_mode: SwingMode.Off };
      (inst as any).service = null;
      
      await inst['handleSet'](true, callback);
      
      expect(platform.log.warn).toHaveBeenCalledWith(
        expect.stringContaining('Service not found for')
      );
      expect(callback).toHaveBeenCalledWith(null);
    });
    
    it('should handle promise-based API with no callback', async () => {
      createAccessory();
      inst.cachedStatus = { swing_mode: SwingMode.Off };
      
      await inst['handleSet'](true);
      
      expect(mockCacheManager.api.setSwingMode).toHaveBeenCalledWith(SwingMode.Horizontal);
      expect(service.updateCharacteristic).toHaveBeenCalledWith('On', true);
    });
    
    it('should throw error for promise-based API when no callback', async () => {
      createAccessory();
      const error = new Error('API error');
      inst.cachedStatus = { swing_mode: SwingMode.Off };
      mockCacheManager.api.setSwingMode.mockRejectedValueOnce(error);
      
      await expect(inst['handleSet'](true)).rejects.toThrow('API error');
      
      expect(platform.log.error).toHaveBeenCalledWith(
        expect.stringContaining('Error setting Horizontal Swing'),
        error
      );
    });
  });
});