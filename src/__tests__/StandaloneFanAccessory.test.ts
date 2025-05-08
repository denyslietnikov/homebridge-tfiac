import { vi, it, expect, describe, beforeEach, afterEach } from 'vitest';
import { StandaloneFanAccessory } from '../StandaloneFanAccessory.js';
import { TfiacPlatform } from '../platform.js';
import { PlatformAccessory, Service } from 'homebridge';
import { createMockPlatformAccessory, createMockService, setupTestPlatform, createMockApiActions, createMockCacheManager } from './testUtils.js';

// Import to get the right type for getInstance mock
import defaultCacheManager from '../CacheManager.js';

// Mock CacheManager module with proper implementation
vi.mock('../CacheManager.js', () => {
  const mockModule = {
    CacheManager: {
      getInstance: vi.fn(),
    },
    default: {
      getInstance: vi.fn(),
    }
  };
  
  return mockModule;
});

// Import CacheManager after mocking
import { CacheManager } from '../CacheManager.js';

describe('StandaloneFanAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let service: Service;
  let deviceAPI: any;
  let mockCacheManager: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    platform = setupTestPlatform();
    service = createMockService();
    accessory = createMockPlatformAccessory('Test Fan', 'test-uuid', { 
      ip: '1.2.3.4', 
      port: 1234, 
      updateInterval: 1, 
      name: 'Test' 
    }, service);
    
    deviceAPI = createMockApiActions({
      is_on: 'on',
      fan_mode: 'Auto'
    });
    
    // Create mock CacheManager
    mockCacheManager = createMockCacheManager(deviceAPI, { is_on: 'on', fan_mode: 'Auto' });
    
    // Mock the getInstance method of CacheManager
    (CacheManager.getInstance as any).mockReturnValue(mockCacheManager);
    (defaultCacheManager.getInstance as any).mockReturnValue(mockCacheManager);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createAccessoryAndOverrideCacheManager() {
    const inst = new StandaloneFanAccessory(platform, accessory);
    // Override the CacheManager with our mock
    (inst as any).cacheManager = mockCacheManager;
    return inst;
  }

  it('should construct and set up polling and handlers', async () => {
    (accessory.getService as ReturnType<typeof vi.fn>).mockReturnValue(null);
    accessory.addService = vi.fn().mockReturnValue(service);

    const inst = createAccessoryAndOverrideCacheManager();
    
    expect(accessory.addService).toHaveBeenCalledWith(platform.Service.Fan, 'Standalone Fan', 'standalone_fan');
    expect(service.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.ConfiguredName, 'Standalone Fan');
    expect(service.getCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On);
    expect(service.getCharacteristic).toHaveBeenCalledWith(platform.Characteristic.RotationSpeed);
  });

  it('should use existing service if available', async () => {
    const service = createMockService();
    (accessory.getService as ReturnType<typeof vi.fn>).mockReturnValue(null);
    accessory.getServiceById = vi.fn().mockReturnValue(service);
    accessory.addService = vi.fn().mockReturnValue(service); // Mock addService to satisfy type, return value doesn't matter for this test
    
    const inst = createAccessoryAndOverrideCacheManager();
    
    expect(accessory.addService).not.toHaveBeenCalled();
    expect(service.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.ConfiguredName, 'Standalone Fan');
  });

  it('should do nothing on stopPolling', async () => {
    const inst = createAccessoryAndOverrideCacheManager();
    // The stopPolling method actually doesn't do anything
    // as per the implementation - it's a no-op stub
    expect(() => inst.stopPolling()).not.toThrow();
  });

  it('should updateStatus and update both characteristics', async () => {
    const inst = createAccessoryAndOverrideCacheManager();
    inst['updateStatus']({ is_on: 'on', fan_mode: 'Auto' });
    expect(service.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, true);
    expect(service.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.RotationSpeed, 50);
  });

  it('should updateStatus with different fan modes', async () => {
    const inst = createAccessoryAndOverrideCacheManager();
    inst['updateStatus']({ is_on: 'on', fan_mode: 'Low' });
    expect(service.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.RotationSpeed, 25);
  });

  it('should log error on updateStatus with error', async () => {
    const inst = createAccessoryAndOverrideCacheManager();
    expect(() => inst['updateStatus'](null)).not.toThrow();
  });

  it('should handle get for On characteristic based on characteristic value', async () => {
    const inst = createAccessoryAndOverrideCacheManager();
    // Set up mocks to return the desired value
    service.getCharacteristic = vi.fn().mockImplementation((characteristic) => {
      return {
        value: characteristic === platform.Characteristic.On ? true : null,
        on: vi.fn().mockReturnThis(),
        updateValue: vi.fn().mockReturnThis()
      };
    });
    
    const result = await new Promise<{ err: any, val: any }>((resolve) => {
      (inst as any).handleGet((err: any, val: any) => {
        resolve({ err, val });
      });
    });
    
    expect(result.err).toBeNull();
    expect(result.val).toBe(true);
  });

  it('should handle get for On characteristic with off state', async () => {
    const inst = createAccessoryAndOverrideCacheManager();
    mockCacheManager.getLastStatus.mockReturnValue({ is_on: 'off' });
    
    const result = await new Promise<{ err: any, val: any }>((resolve) => {
      (inst as any).handleGet((err: any, val: any) => {
        resolve({ err, val });
      });
    });
    
    expect(result.err).toBeNull();
    expect(result.val).toBe(false);
  });

  it('should handle get for On characteristic with no cached status', async () => {
    const inst = createAccessoryAndOverrideCacheManager();
    mockCacheManager.getLastStatus.mockReturnValue(null);
    
    const result = await new Promise<{ err: any, val: any }>((resolve) => {
      (inst as any).handleGet((err: any, val: any) => {
        resolve({ err, val });
      });
    });
    
    expect(result.err).toBeNull();
    expect(result.val).toBe(false);
  });

  it('should handle set for On characteristic to turn on', async () => {
    const inst = createAccessoryAndOverrideCacheManager();
    
    await new Promise<void>((resolve) => {
      (inst as any).handleSet(true, (err: any) => {
        resolve();
      });
    });
    
    expect(deviceAPI.turnOn).toHaveBeenCalled();
    expect(mockCacheManager.clear).toHaveBeenCalled();
  });

  it('should handle set for On characteristic to turn off', async () => {
    const inst = createAccessoryAndOverrideCacheManager();
    
    await new Promise<void>((resolve) => {
      (inst as any).handleSet(false, (err: any) => {
        resolve();
      });
    });
    
    expect(deviceAPI.turnOff).toHaveBeenCalled();
    expect(mockCacheManager.clear).toHaveBeenCalled();
  });

  it('should handle set error for On characteristic', async () => {
    deviceAPI.turnOn.mockRejectedValueOnce(new Error('fail'));
    const inst = createAccessoryAndOverrideCacheManager();
    
    const result = await new Promise<Error | null>((resolve) => {
      (inst as any).handleSet(true, (err: Error | null) => {
        resolve(err);
      });
    });
    
    expect(result).toBeInstanceOf(Error);
    expect(result?.message).toBe('fail');
  });

  it('should handle get for RotationSpeed based on characteristic value', async () => {
    const inst = createAccessoryAndOverrideCacheManager();
    // Set up mocks to return the desired value for rotation speed
    service.getCharacteristic = vi.fn().mockImplementation((characteristic) => {
      return {
        value: characteristic === platform.Characteristic.RotationSpeed ? 75 : null,
        on: vi.fn().mockReturnThis(),
        updateValue: vi.fn().mockReturnThis()
      };
    });
    
    const result = await new Promise<{ err: any, val: any }>((resolve) => {
      (inst as any).handleRotationSpeedGet((err: any, val: any) => {
        resolve({ err, val });
      });
    });
    
    expect(result.err).toBeNull();
    expect(result.val).toBe(75);
  });

  it('should handle get for RotationSpeed with no cached status', async () => {
    const inst = createAccessoryAndOverrideCacheManager();
    mockCacheManager.getLastStatus.mockReturnValue(null);
    
    const result = await new Promise<{ err: any, val: any }>((resolve) => {
      (inst as any).handleRotationSpeedGet((err: any, val: any) => {
        resolve({ err, val });
      });
    });
    
    expect(result.err).toBeNull();
    expect(result.val).toBe(50);
  });

  it('should handle set for RotationSpeed to Low', async () => {
    const inst = createAccessoryAndOverrideCacheManager();
    
    await new Promise<void>((resolve) => {
      (inst as any).handleRotationSpeedSet(20, (err: any) => {
        resolve();
      });
    });
    
    expect(deviceAPI.setFanSpeed).toHaveBeenCalledWith('Low');
    expect(mockCacheManager.clear).toHaveBeenCalled();
  });

  it('should handle set for RotationSpeed to Middle', async () => {
    const inst = createAccessoryAndOverrideCacheManager();
    
    await new Promise<void>((resolve) => {
      (inst as any).handleRotationSpeedSet(40, (err: any) => {
        resolve();
      });
    });
    
    expect(deviceAPI.setFanSpeed).toHaveBeenCalledWith('Middle');
    expect(mockCacheManager.clear).toHaveBeenCalled();
  });

  it('should handle set for RotationSpeed to High', async () => {
    const inst = createAccessoryAndOverrideCacheManager();
    
    await new Promise<void>((resolve) => {
      (inst as any).handleRotationSpeedSet(70, (err: any) => {
        resolve();
      });
    });
    
    expect(deviceAPI.setFanSpeed).toHaveBeenCalledWith('High');
    expect(mockCacheManager.clear).toHaveBeenCalled();
  });

  it('should handle set for RotationSpeed to Auto', async () => {
    const inst = createAccessoryAndOverrideCacheManager();
    
    await new Promise<void>((resolve) => {
      (inst as any).handleRotationSpeedSet(90, (err: any) => {
        resolve();
      });
    });
    
    expect(deviceAPI.setFanSpeed).toHaveBeenCalledWith('Auto');
    expect(mockCacheManager.clear).toHaveBeenCalled();
  });

  it('should handle set error for RotationSpeed', async () => {
    const error = new Error('fail');
    deviceAPI.setFanSpeed.mockRejectedValueOnce(error);
    const inst = createAccessoryAndOverrideCacheManager();
    
    const result = await new Promise<Error | null>((resolve) => {
      (inst as any).handleRotationSpeedSet(40, (err: Error | null) => {
        resolve(err);
      });
    });
    
    expect(result).toBeInstanceOf(Error);
    expect(result?.message).toBe('fail');
  });

  it('should map fan modes to rotation speeds correctly', async () => {
    const inst = createAccessoryAndOverrideCacheManager();
    expect((inst as any).mapFanModeToRotationSpeed('Auto')).toBe(50);
    expect((inst as any).mapFanModeToRotationSpeed('Low')).toBe(25);
    expect((inst as any).mapFanModeToRotationSpeed('Middle')).toBe(50);
    expect((inst as any).mapFanModeToRotationSpeed('High')).toBe(75);
    expect((inst as any).mapFanModeToRotationSpeed('Unknown')).toBe(50);
  });

  it('should map rotation speeds to fan modes correctly', async () => {
    const inst = createAccessoryAndOverrideCacheManager();
    // Exactly 0% → Auto
    expect((inst as any).mapRotationSpeedToFanMode(0)).toBe('Auto');
    // 1-25% → Low
    expect((inst as any).mapRotationSpeedToFanMode(10)).toBe('Low');
    // 26-50% → Middle
    expect((inst as any).mapRotationSpeedToFanMode(40)).toBe('Middle');
    // 51-75% → High
    expect((inst as any).mapRotationSpeedToFanMode(60)).toBe('High');
    // 76-100% → Auto (code returns Auto for values > 75%)
    expect((inst as any).mapRotationSpeedToFanMode(90)).toBe('Auto');
  });
});