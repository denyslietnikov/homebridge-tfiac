import { StandaloneFanAccessory } from '../StandaloneFanAccessory.js';
import { TfiacPlatform } from '../platform.js';
import { PlatformAccessory, Service } from 'homebridge';
import { createMockPlatformAccessory, createMockService, setupTestPlatform, createMockApiActions } from './testUtils.js';

describe('StandaloneFanAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let service: Service;
  let deviceAPI: any;

  beforeEach(() => {
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
    
    jest.spyOn(require('../AirConditionerAPI'), 'default').mockImplementation(() => deviceAPI);

    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('should construct and set up polling and handlers', () => {
    (accessory.getService as jest.Mock).mockReturnValue(null);
    (accessory.addService as jest.Mock).mockReturnValue(service);

    const inst = new StandaloneFanAccessory(platform, accessory);
    const addedService = service;
    expect(accessory.addService).toHaveBeenCalledWith(platform.Service.Fan, 'Standalone Fan', 'standalone_fan');
    // ConfiguredName is set now instead of Name, which is set during addService
    expect(addedService.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.ConfiguredName, 'Standalone Fan');
    expect(addedService.getCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On);
    expect(addedService.getCharacteristic).toHaveBeenCalledWith(platform.Characteristic.RotationSpeed);
  });

  it('should use existing service if available', () => {
    const service = createMockService();
    (accessory.getService as jest.Mock).mockReturnValue(null); // ensure path uses getServiceById
    // Replace getService with getServiceById to match implementation
    accessory.getServiceById = jest.fn().mockReturnValue(service);
    accessory.addService = jest.fn();
    const inst = new StandaloneFanAccessory(platform, accessory);
    expect(accessory.addService).not.toHaveBeenCalled();
    // ConfiguredName is set now instead of Name
    expect(service.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.ConfiguredName, 'Standalone Fan');
  });

  it('should do nothing on stopPolling', () => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    inst.stopPolling();
    expect(deviceAPI.cleanup).not.toHaveBeenCalled();
  });

  it('should updateStatus and update both characteristics', () => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    inst['updateStatus']({ is_on: 'on', fan_mode: 'Auto' });
    expect(service.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.On, true);
    expect(service.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.RotationSpeed, 50);
  });

  it('should updateStatus with different fan modes', () => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    inst['updateStatus']({ is_on: 'on', fan_mode: 'Low' });
    expect(service.updateCharacteristic).toHaveBeenCalledWith(platform.Characteristic.RotationSpeed, 25);
  });

  it('should log error on updateStatus with error', () => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    // simulate error by calling updateStatus with null and expecting no throw
    expect(() => inst['updateStatus'](null)).not.toThrow();
  });

  it('should handle get for On characteristic based on characteristic value', done => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    const charMock: any = service.getCharacteristic(platform.Characteristic.On);
    charMock.value = true;
    (inst as any).handleGet((err: any, val: any) => {
      expect(err).toBeNull();
      expect(val).toBe(true);
      done();
    });
  });

  it('should handle get for On characteristic with off state', done => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    (inst as any).cachedStatus = { is_on: 'off' };
    (inst as any).handleGet((err: any, val: any) => {
      expect(err).toBeNull();
      expect(val).toBe(false);
      done();
    });
  });

  it('should handle get for On characteristic with no cached status', done => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    (inst as any).cachedStatus = null;
    (inst as any).handleGet((err: any, val: any) => {
      expect(err).toBeNull();
      expect(val).toBe(false);
      done();
    });
  });

  it('should handle set for On characteristic to turn on', async () => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    const cb = jest.fn();
    await (inst as any).handleSet(true, cb);
    expect(deviceAPI.turnOn).toHaveBeenCalled();
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('should handle set for On characteristic to turn off', async () => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    const cb = jest.fn();
    await (inst as any).handleSet(false, cb);
    expect(deviceAPI.turnOff).toHaveBeenCalled();
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('should handle set error for On characteristic', async () => {
    deviceAPI.turnOn.mockRejectedValueOnce(new Error('fail'));
    const inst = new StandaloneFanAccessory(platform, accessory);
    const cb = jest.fn();
    await (inst as any).handleSet(true, cb);
    expect(cb).toHaveBeenCalledWith(expect.any(Error));
  });

  it('should handle get for RotationSpeed based on characteristic value', done => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    const charMock: any = service.getCharacteristic(platform.Characteristic.RotationSpeed);
    charMock.value = 75;
    (inst as any).handleRotationSpeedGet((err: any, val: any) => {
      expect(err).toBeNull();
      expect(val).toBe(75);
      done();
    });
  });

  it('should handle get for RotationSpeed with no cached status', done => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    (inst as any).cachedStatus = null;
    (inst as any).handleRotationSpeedGet((err: any, val: any) => {
      expect(err).toBeNull();
      expect(val).toBe(50);
      done();
    });
  });

  it('should handle set for RotationSpeed to Low', async () => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    const cb = jest.fn();
    await (inst as any).handleRotationSpeedSet(20, cb);
    expect(deviceAPI.setFanSpeed).toHaveBeenCalledWith('Low');
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('should handle set for RotationSpeed to Middle', async () => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    const cb = jest.fn();
    await (inst as any).handleRotationSpeedSet(40, cb);
    expect(deviceAPI.setFanSpeed).toHaveBeenCalledWith('Middle');
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('should handle set for RotationSpeed to High', async () => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    const cb = jest.fn();
    await (inst as any).handleRotationSpeedSet(70, cb);
    expect(deviceAPI.setFanSpeed).toHaveBeenCalledWith('High');
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('should handle set for RotationSpeed to Auto', async () => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    const cb = jest.fn();
    await (inst as any).handleRotationSpeedSet(90, cb);
    expect(deviceAPI.setFanSpeed).toHaveBeenCalledWith('Auto');
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('should handle set error for RotationSpeed', async () => {
    deviceAPI.setFanSpeed.mockRejectedValueOnce(new Error('fail'));
    const inst = new StandaloneFanAccessory(platform, accessory);
    const cb = jest.fn();
    await (inst as any).handleRotationSpeedSet(50, cb);
    expect(cb).toHaveBeenCalledWith(expect.any(Error));
  });

  it('should map fan modes to rotation speeds correctly', () => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    expect((inst as any).mapFanModeToRotationSpeed('Auto')).toBe(50);
    expect((inst as any).mapFanModeToRotationSpeed('Low')).toBe(25);
    expect((inst as any).mapFanModeToRotationSpeed('Middle')).toBe(50);
    expect((inst as any).mapFanModeToRotationSpeed('High')).toBe(75);
    expect((inst as any).mapFanModeToRotationSpeed('Unknown')).toBe(50); // Default
  });

  it('should map rotation speeds to fan modes correctly', () => {
    const inst = new StandaloneFanAccessory(platform, accessory);
    expect((inst as any).mapRotationSpeedToFanMode(20)).toBe('Low');
    expect((inst as any).mapRotationSpeedToFanMode(40)).toBe('Middle');
    expect((inst as any).mapRotationSpeedToFanMode(70)).toBe('High');
    expect((inst as any).mapRotationSpeedToFanMode(100)).toBe('Auto');
  });
});