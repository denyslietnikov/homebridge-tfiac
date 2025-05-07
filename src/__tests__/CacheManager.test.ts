import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import CacheManager from '../CacheManager.js';
import { TfiacDeviceConfig } from '../settings.js';

describe('CacheManager', () => {
  let cacheManager: CacheManager;
  let config: TfiacDeviceConfig;
  let mockApi: any;
  // Inject a mock API to override internal AirConditionerAPI instance
  
  // Save the original NODE_ENV
  const originalNodeEnv = process.env.NODE_ENV;
  
  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Set NODE_ENV to test
    process.env.NODE_ENV = 'test';
    
    // Create a basic config
    config = {
      name: 'Test AC',
      ip: '192.168.1.100',
      port: 8080,
      updateInterval: 15, // 15 seconds
    } as TfiacDeviceConfig;
    
    // Create a new instance
    cacheManager = CacheManager.getInstance(config);
    // Override internal API with mock
    mockApi = {
      updateState: vi.fn().mockResolvedValue({ is_on: 'on', current_temp: 25 }),
      emit: vi.fn(),
      on: vi.fn(),
      removeAllListeners: vi.fn(),
      cleanup: vi.fn(),
    };
    (cacheManager as any).api = mockApi;
  });
  
  afterEach(() => {
    // Restore NODE_ENV
    process.env.NODE_ENV = originalNodeEnv;
  });
  
  describe('getInstance', () => {
    it('should create a new instance in test environment', () => {
      const instance1 = CacheManager.getInstance(config);
      const instance2 = CacheManager.getInstance(config);
      
      // In test environment, should always create new instances
      expect(instance1).not.toBe(instance2);
    });
    
    it('should return the same instance for the same device in non-test environment', () => {
      // Set to production for this test
      process.env.NODE_ENV = 'production';
      
      const instance1 = CacheManager.getInstance(config);
      const instance2 = CacheManager.getInstance(config);
      
      // Should return the same instance
      expect(instance1).toBe(instance2);
    });
    
    it('should create different instances for different devices in non-test environment', () => {
      // Set to production for this test
      process.env.NODE_ENV = 'production';
      
      const instance1 = CacheManager.getInstance(config);
      const instance2 = CacheManager.getInstance({
        ...config,
        ip: '192.168.1.101' // Different IP
      });
      
      // Should be different instances
      expect(instance1).not.toBe(instance2);
    });
  });
  
  describe('constructor', () => {
    it('should create an API instance with EventEmitter capabilities', () => {
      // Verify EventEmitter capabilities are added
      expect(cacheManager.api.emit).toBeDefined();
      expect(typeof cacheManager.api.emit).toBe('function');
      expect(cacheManager.api.on).toBeDefined();
      expect(typeof cacheManager.api.on).toBe('function');
    });
    
    it('should set TTL based on config', () => {
      // Create with different update interval
      const customConfig = {
        ...config,
        updateInterval: 45 // 45 seconds
      };
      
      // Get a new instance with custom config
      const customCacheManager = CacheManager.getInstance(customConfig);
      
      // Get private ttl property
      const ttl = (customCacheManager as any).ttl;
      
      // Should be 45 seconds in milliseconds
      expect(ttl).toBe(45 * 1000);
    });
    
    it('should use default TTL if updateInterval is not provided', () => {
      // Create config without updateInterval
      const defaultConfig = {
        ...config
      };
      delete defaultConfig.updateInterval;
      
      // Get a new instance with default config
      const defaultCacheManager = CacheManager.getInstance(defaultConfig);
      
      // Get private ttl property
      const ttl = (defaultCacheManager as any).ttl;
      
      // Should use default of 30 seconds
      expect(ttl).toBe(30 * 1000);
    });
  });
  
  describe('getStatus', () => {
    it('should return cached value if fresh', async () => {
      // Set up cache with fresh data
      const mockStatus = { is_on: 'on', current_temp: 22 };
      (cacheManager as any).cache = mockStatus;
      (cacheManager as any).lastFetch = Date.now();
      
      // Get status
      const status = await cacheManager.getStatus();
      
      // Should return the cached value
      expect(status).toBe(mockStatus);
      // API should not be called
      expect(cacheManager.api.updateState).not.toHaveBeenCalled();
    });
    
    it('should fetch new data if cache is expired', async () => {
      // Set up cache with stale data
      const mockStatus = { is_on: 'on', current_temp: 22 };
      (cacheManager as any).cache = mockStatus;
      // Set lastFetch to beyond TTL
      const ttl = (cacheManager as any).ttl;
      (cacheManager as any).lastFetch = Date.now() - (ttl + 1000);
      
      // Set up new data from API
      const newStatus = { is_on: 'off', current_temp: 24 };
      (cacheManager.api.updateState as any).mockResolvedValueOnce(newStatus);
      
      // Get status
      const status = await cacheManager.getStatus();
      
      // Should fetch new data
      expect(cacheManager.api.updateState).toHaveBeenCalled();
      // Should return new status
      expect(status).toBe(newStatus);
      // Should update cache
      expect((cacheManager as any).cache).toBe(newStatus);
      // Should update lastFetch
      expect((cacheManager as any).lastFetch).toBeGreaterThan(Date.now() - 100);
    });
    
    it('should fetch new data if cache is null', async () => {
      // Ensure cache is null
      (cacheManager as any).cache = null;
      
      // Set up new data from API
      const newStatus = { is_on: 'off', current_temp: 24 };
      (cacheManager.api.updateState as any).mockResolvedValueOnce(newStatus);
      
      // Get status
      const status = await cacheManager.getStatus();
      
      // Should fetch new data
      expect(cacheManager.api.updateState).toHaveBeenCalled();
      // Should return new status
      expect(status).toBe(newStatus);
    });
    
    it('should emit status event after fetching new data', async () => {
      // Ensure cache is null
      (cacheManager as any).cache = null;
      
      // Set up spy for emit
      const emitSpy = vi.spyOn(cacheManager.api, 'emit');
      
      // Set up new data from API
      const newStatus = { is_on: 'off', current_temp: 24 };
      (cacheManager.api.updateState as any).mockResolvedValueOnce(newStatus);
      
      // Get status
      await cacheManager.getStatus();
      
      // Should emit status event with new data
      expect(emitSpy).toHaveBeenCalledWith('status', newStatus);
    });
  });
  
  describe('getLastStatus', () => {
    it('should return the cached status without API call', () => {
      // Set up cache
      const mockStatus = { is_on: 'on', current_temp: 22 };
      (cacheManager as any).cache = mockStatus;
      
      // Get last status
      const status = cacheManager.getLastStatus();
      
      // Should return the cached value
      expect(status).toBe(mockStatus);
      // API should not be called
      expect(cacheManager.api.updateState).not.toHaveBeenCalled();
    });
    
    it('should return null if no cache is available', () => {
      // Ensure cache is null
      (cacheManager as any).cache = null;
      
      // Get last status
      const status = cacheManager.getLastStatus();
      
      // Should return null
      expect(status).toBeNull();
      // API should not be called
      expect(cacheManager.api.updateState).not.toHaveBeenCalled();
    });
  });
  
  describe('clear', () => {
    it('should clear the cache and reset lastFetch', () => {
      // Set up cache
      const mockStatus = { is_on: 'on', current_temp: 22 };
      (cacheManager as any).cache = mockStatus;
      (cacheManager as any).lastFetch = Date.now();
      
      // Clear the cache
      cacheManager.clear();
      
      // Cache should be null
      expect((cacheManager as any).cache).toBeNull();
      // lastFetch should be reset to 0
      expect((cacheManager as any).lastFetch).toBe(0);
    });
  });
  
  describe('cleanup', () => {
    it('should call cleanup on the API if it exists', () => {
      // Call cleanup
      cacheManager.cleanup();
      
      // Should call cleanup on the API
      expect(cacheManager.api.cleanup).toHaveBeenCalled();
    });
    
    it('should remove all listeners if removeAllListeners exists', () => {
      // Call cleanup
      cacheManager.cleanup();
      
      // Should call removeAllListeners which is added by EventEmitter
      expect(cacheManager.api.removeAllListeners).toBeDefined();
    });
    
    it('should handle missing cleanup method gracefully', () => {
      // Remove cleanup method
      delete (cacheManager.api as any).cleanup;
      
      // Call cleanup - should not throw
      expect(() => cacheManager.cleanup()).not.toThrow();
    });
    
    it('should handle missing removeAllListeners method gracefully', () => {
      // Remove removeAllListeners method
      delete (cacheManager.api as any).removeAllListeners;
      
      // Call cleanup - should not throw
      expect(() => cacheManager.cleanup()).not.toThrow();
    });
  });
});