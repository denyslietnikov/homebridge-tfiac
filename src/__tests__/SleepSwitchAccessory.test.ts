import { SleepSwitchAccessory } from '../SleepSwitchAccessory';
import { TfiacPlatform } from '../platform';
import { PlatformAccessory, Service } from 'homebridge';

describe('SleepSwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let service: Service;
  let deviceAPI: any;
  let log: any;

  beforeEach(() => {
    log = { debug: jest.fn(), error: jest.fn() };
    platform = {
      Service: { Switch: jest.fn() },
      Characteristic: { Name: 'Name', On: 'On' },
      log,
    } as any;
    service = {
      setCharacteristic: jest.fn(),
      getCharacteristic: jest.fn().mockReturnThis(),
      on: jest.fn().mockReturnThis(),
      updateCharacteristic: jest.fn(),
    } as any;
    accessory = {
      context: { deviceConfig: { ip: '1.2.3.4', port: 1234, updateInterval: 1, name: 'Test' } },
      getService: jest.fn().mockReturnValue(undefined),
      addService: jest.fn().mockReturnValue(service),
    } as any;
    deviceAPI = {
      updateState: jest.fn().mockResolvedValue({ opt_sleepMode: 'on' }),
      setSleepState: jest.fn().mockResolvedValue(undefined),
      cleanup: jest.fn(),
    };
    jest.spyOn(require('../AirConditionerAPI'), 'default').mockImplementation(() => deviceAPI);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('should construct and set up polling and handlers', () => {
    const inst = new SleepSwitchAccessory(platform, accessory);
    expect(accessory.addService).toHaveBeenCalled();
    expect(service.setCharacteristic).toHaveBeenCalledWith('Name', 'Sleep');
    expect(service.on).toHaveBeenCalled();
  });

  it('should use existing service if available', () => {
    accessory.getService = jest.fn().mockReturnValue(service);
    const inst = new SleepSwitchAccessory(platform, accessory);
    expect(accessory.addService).not.toHaveBeenCalled();
    expect(service.setCharacteristic).toHaveBeenCalledWith('Name', 'Sleep');
  });

  it('should stop polling and cleanup', () => {
    const inst = new SleepSwitchAccessory(platform, accessory);
    (inst as any).pollingInterval = setInterval(() => {}, 1000);
    inst.stopPolling();
    expect(deviceAPI.cleanup).toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalled();
  });

  it('should start polling', () => {
    jest.useFakeTimers();
    const inst = new SleepSwitchAccessory(platform, accessory);
  
    // Test that polling is started
    expect(deviceAPI.updateState).toHaveBeenCalled();
    const callCountAtStart = deviceAPI.updateState.mock.calls.length;
  
    // Advance timers to trigger polling
    jest.advanceTimersByTime(30000);
    expect(deviceAPI.updateState.mock.calls.length).toBeGreaterThan(callCountAtStart);
  
    // Test stopping the polling
    inst.stopPolling();
    const callsAfterStop = deviceAPI.updateState.mock.calls.length;
    jest.advanceTimersByTime(30000);
    expect(deviceAPI.updateState.mock.calls.length).toBe(callsAfterStop);
  
    jest.useRealTimers();
  });

  it('should update cached status and update characteristic', async () => {
    const inst = new SleepSwitchAccessory(platform, accessory);
    await (inst as any).updateCachedStatus();
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', true);
  });

  it('should handle get with cached status (on)', done => {
    const inst = new SleepSwitchAccessory(platform, accessory);
    (inst as any).cachedStatus = {
      opt_sleepMode: 'on',
      current_temp: 0,
      target_temp: 0,
      operation_mode: '',
      fan_mode: '',
      swing_mode: '',
      opt_display: '',
    };
    (inst as any).handleGet((err: any, val: any) => {
      expect(err).toBeNull();
      expect(val).toBe(true);
      done();
    });
  });

  it('should handle get with cached status (off)', done => {
    const inst = new SleepSwitchAccessory(platform, accessory);
    (inst as any).cachedStatus = {
      opt_sleepMode: 'off',
      current_temp: 0,
      target_temp: 0,
      operation_mode: '',
      fan_mode: '',
      swing_mode: '',
      opt_display: '',
    };
    (inst as any).handleGet((err: any, val: any) => {
      expect(err).toBeNull();
      expect(val).toBe(false);
      done();
    });
  });

  it('should handle get with no cached status', done => {
    const inst = new SleepSwitchAccessory(platform, accessory);
    (inst as any).cachedStatus = null;
    (inst as any).handleGet((err: any, val: any) => {
      // Now expecting default value (false) instead of an error
      expect(err).toBeNull();
      expect(val).toBe(false);
      done();
    });
  });

  it('should handle exception in handleGet callback', () => {
    jest.useFakeTimers();
    const inst = new SleepSwitchAccessory(platform, accessory);
    // Force an error by defining a getter that throws
    Object.defineProperty(inst as any, 'cachedStatus', { get: () => { throw new Error('Test error'); } });

    (inst as any).handleGet((err: any, val: any) => {
      // Should return default value instead of error
      expect(err).toBeNull();
      expect(val).toBe(false);
    });
  });

  it('should handle set and update status', async () => {
    const inst = new SleepSwitchAccessory(platform, accessory);
    const cb = jest.fn();
    await (inst as any).handleSet(true, cb);
    expect(deviceAPI.setSleepState).toHaveBeenCalledWith('on');
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('should handle set error', async () => {
    deviceAPI.setSleepState.mockRejectedValueOnce(new Error('fail'));
    const inst = new SleepSwitchAccessory(platform, accessory);
    const cb = jest.fn();
    await (inst as any).handleSet(true, cb);
    expect(cb).toHaveBeenCalledWith(expect.any(Error));
  });

  it('should handle errors when updating cached status', async () => {
    const apiError = new Error('API Error');
    deviceAPI.updateState.mockRejectedValueOnce(apiError);
    
    const sleepAccessory = new SleepSwitchAccessory(platform, accessory);
    
    // Call the updateCachedStatus method directly
    await (sleepAccessory as any).updateCachedStatus();
    
    // Verify error was logged
    expect(log.error).toHaveBeenCalledWith('Error updating sleep status:', apiError);
  });
  
  it('should handle null cached status in handleGet', (done) => {
    const sleepAccessory = new SleepSwitchAccessory(platform, accessory);
    (sleepAccessory as any).cachedStatus = null;
    
    // Call the handleGet method directly
    (sleepAccessory as any).handleGet((err: Error | null, value: any) => {
      expect(err).toBeNull();
      expect(value).toBe(false); // Default value for sleep mode when cache is null
      done();
    });
  });
  
  it('should handle API errors in handleSet', async () => {
    const apiError = new Error('API Error');
    deviceAPI.setSleepState.mockRejectedValueOnce(apiError);
    
    const sleepAccessory = new SleepSwitchAccessory(platform, accessory);
    const callback = jest.fn();
    
    // Call the handleSet method with a value of true (enable sleep)
    await (sleepAccessory as any).handleSet(true, callback);
    
    // Verify the callback was called with the error
    expect(callback).toHaveBeenCalledWith(apiError);
  });
  
  it('should properly call setSleepState with the correct value', async () => {
    const sleepAccessory = new SleepSwitchAccessory(platform, accessory);
    const callback = jest.fn();
    
    // Call the handleSet method with a value of true (enable sleep)
    await (sleepAccessory as any).handleSet(true, callback);
    
    // Verify setSleepState was called with 'on'
    expect(deviceAPI.setSleepState).toHaveBeenCalledWith('on');
    expect(callback).toHaveBeenCalledWith(null);
    
    // Reset mock and test with false value
    deviceAPI.setSleepState.mockClear();
    callback.mockClear();
    
    // Call with false (disable sleep)
    await (sleepAccessory as any).handleSet(false, callback);
    
    // Verify setSleepState was called with 'off'
    expect(deviceAPI.setSleepState).toHaveBeenCalledWith('off');
    expect(callback).toHaveBeenCalledWith(null);
  });
  
  it('should handle different cached sleep state values', (done) => {
    const sleepAccessory = new SleepSwitchAccessory(platform, accessory);
    
    // Test with opt_sleepMode 'on'
    (sleepAccessory as any).cachedStatus = { opt_sleepMode: 'on' };
    (sleepAccessory as any).handleGet((err: Error | null, value: any) => {
      expect(err).toBeNull();
      expect(value).toBe(true);
      
      // Now test with opt_sleepMode 'off'
      (sleepAccessory as any).cachedStatus = { opt_sleepMode: 'off' };
      (sleepAccessory as any).handleGet((err2: Error | null, value2: any) => {
        expect(err2).toBeNull();
        expect(value2).toBe(false);
        
        // Test with invalid opt_sleepMode
        (sleepAccessory as any).cachedStatus = { opt_sleepMode: 'invalid' };
        (sleepAccessory as any).handleGet((err3: Error | null, value3: any) => {
          expect(err3).toBeNull();
          expect(value3).toBe(false); // Default to false for unknown values
          done();
        });
      });
    });
  });
});