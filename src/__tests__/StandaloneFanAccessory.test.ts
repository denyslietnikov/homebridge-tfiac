import { vi, it, expect, describe, beforeEach, afterEach } from 'vitest';
import { StandaloneFanAccessory } from '../StandaloneFanAccessory.js';
import { TfiacPlatform } from '../platform.js';
import { PlatformAccessory, Service } from 'homebridge';
import { createMockPlatformAccessory, createMockService, setupTestPlatform, createMockApiActions } from './testUtils.js';

describe('StandaloneFanAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let service: Service;
  let deviceAPI: any;

  beforeEach(async () => {
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
    
    vi.spyOn(await import('../AirConditionerAPI'), 'default').mockImplementation(() => deviceAPI);

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('should construct and set up polling and handlers', async () => {
    (accessory.getService as ReturnType<typeof vi.fn>).mockReturnValue(null);
    accessory.addService = vi.fn().mockReturnValue(service);

    const inst = new StandaloneFanAccessory(platform, accessory);
    const addedService = service;
    expect(accessory.addService).toHaveBeenCalledWith(platform.Service.Fan, 'Standalone Fan', 'standalone_fan');
    expect(addedService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.ConfiguredName, 'Standalone Fan');
    expect(addedService.getCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On);
    expect(addedService.getCharacteristic).toHaveBeenCalledWith(platform.Characteristic.RotationSpeed);
  });

  it('should use existing service if available', async () => {
    const service = createMockService();
    (accessory.getService as ReturnType<typeof vi.fn>).mockReturnValue(null);
    accessory.getServiceById = vi.fn().mockReturnValue(service);
    accessory.addService = vi.fn().mockReturnValue(service); // Mock addService to satisfy type, return value doesn't matter for this test
    const inst = new StandaloneFanAccessory(platform, accessory);
    expect(accessory.addService).not.toHaveBeenCalled();
    expect(service.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.ConfiguredName, 'Standalone Fan');
  });

  it('should do nothing on stopPolling', async () => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    inst.stopPolling();
    expect(deviceAPI.cleanup).not.toHaveBeenCalled();
  });

  it('should updateStatus and update both characteristics', async () => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    inst['updateStatus']({ is_on: 'on', fan_mode: 'Auto' });
    expect(service.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, true);
    expect(service.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.RotationSpeed, 50);
  });

  it('should updateStatus with different fan modes', async () => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    inst['updateStatus']({ is_on: 'on', fan_mode: 'Low' });
    expect(service.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.RotationSpeed, 25);
  });

  it('should log error on updateStatus with error', async () => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    expect(() => inst['updateStatus'](null)).not.toThrow();
  });

  it('should handle get for On characteristic based on characteristic value', async () => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    const charMock: any = service.getCharacteristic(platform.Characteristic.On);
    charMock.value = true;
    const result = await new Promise<{ err: any, val: any }>((resolve) => {
      (inst as any).handleGet((err: any, val: any) => {
        resolve({ err, val });
      });
    });
    expect(result.err).toBeNull();
    expect(result.val).toBe(true);
  });

  it('should handle get for On characteristic with off state', async () => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    (inst as any).cachedStatus = { is_on: 'off' };
    const result = await new Promise<{ err: any, val: any }>((resolve) => {
      (inst as any).handleGet((err: any, val: any) => {
        resolve({ err, val });
      });
    });
    expect(result.err).toBeNull();
    expect(result.val).toBe(false);
  });

  it('should handle get for On characteristic with no cached status', async () => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    (inst as any).cachedStatus = null;
    const result = await new Promise<{ err: any, val: any }>((resolve) => {
      (inst as any).handleGet((err: any, val: any) => {
        resolve({ err, val });
      });
    });
    expect(result.err).toBeNull();
    expect(result.val).toBe(false);
  });

  it('should handle set for On characteristic to turn on', async () => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    await (inst as any).handleSet(true);
    expect(deviceAPI.turnOn).toHaveBeenCalled();
  });

  it('should handle set for On characteristic to turn off', async () => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    await (inst as any).handleSet(false);
    expect(deviceAPI.turnOff).toHaveBeenCalled();
  });

  it('should handle set error for On characteristic', async () => {
    deviceAPI.turnOn.mockRejectedValueOnce(new Error('fail'));
    const inst = new StandaloneFanAccessory(platform, accessory);
    
    await expect(async () => {
      await new Promise<void>((resolve, reject) => {
        (inst as any).handleSet(true, (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }).rejects.toThrow('fail');
  });

  it('should handle get for RotationSpeed based on characteristic value', async () => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    const charMock: any = service.getCharacteristic(platform.Characteristic.RotationSpeed);
    charMock.value = 75;
    const result = await new Promise<{ err: any, val: any }>((resolve) => {
      (inst as any).handleRotationSpeedGet((err: any, val: any) => {
        resolve({ err, val });
      });
    });
    expect(result.err).toBeNull();
    expect(result.val).toBe(75);
  });

  it('should handle get for RotationSpeed with no cached status', async () => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    (inst as any).cachedStatus = null;
    const result = await new Promise<{ err: any, val: any }>((resolve) => {
      (inst as any).handleRotationSpeedGet((err: any, val: any) => {
        resolve({ err, val });
      });
    });
    expect(result.err).toBeNull();
    expect(result.val).toBe(50);
  });

  it('should handle set for RotationSpeed to Low', async () => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    await (inst as any).handleRotationSpeedSet(20);
    expect(deviceAPI.setFanSpeed).toHaveBeenCalledWith('Low');
  });

  it('should handle set for RotationSpeed to Middle', async () => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    await (inst as any).handleRotationSpeedSet(40);
    expect(deviceAPI.setFanSpeed).toHaveBeenCalledWith('Middle');
  });

  it('should handle set for RotationSpeed to High', async () => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    await (inst as any).handleRotationSpeedSet(70);
    expect(deviceAPI.setFanSpeed).toHaveBeenCalledWith('High');
  });

  it('should handle set for RotationSpeed to Auto', async () => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    await (inst as any).handleRotationSpeedSet(90);
    expect(deviceAPI.setFanSpeed).toHaveBeenCalledWith('Auto');
  });

  it('should handle set error for RotationSpeed', async () => {
    const error = new Error('fail');
    deviceAPI.setFanSpeed.mockRejectedValueOnce(error);
    const inst = new StandaloneFanAccessory(platform, accessory);
    
    await expect(async () => {
      await new Promise<void>((resolve, reject) => {
        (inst as any).handleRotationSpeedSet(40, (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }).rejects.toThrow('fail');
  });

  it('should map fan modes to rotation speeds correctly', async () => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    expect((inst as any).mapFanModeToRotationSpeed('Auto')).toBe(50);
    expect((inst as any).mapFanModeToRotationSpeed('Low')).toBe(25);
    expect((inst as any).mapFanModeToRotationSpeed('Middle')).toBe(50);
    expect((inst as any).mapFanModeToRotationSpeed('High')).toBe(75);
    expect((inst as any).mapFanModeToRotationSpeed('Unknown')).toBe(50);
  });

  it('should map rotation speeds to fan modes correctly', async () => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    expect((inst as any).mapRotationSpeedToFanMode(20)).toBe('Low');
    expect((inst as any).mapRotationSpeedToFanMode(40)).toBe('Middle');
    expect((inst as any).mapRotationSpeedToFanMode(70)).toBe('High');
    expect((inst as any).mapRotationSpeedToFanMode(100)).toBe('Auto');
  });
});