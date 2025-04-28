import { PlatformAccessory } from 'homebridge';
import { BaseSwitchAccessory } from '../BaseSwitchAccessory.js';
import { TfiacPlatform } from '../platform.js';

jest.useFakeTimers();

// Mocks for AirConditionerAPI
const updateStateMock = jest.fn();
const cleanupMock = jest.fn();

jest.mock('../AirConditionerAPI.js', () => {
  return jest.fn().mockImplementation(() => ({
    updateState: updateStateMock,
    cleanup: cleanupMock,
  }));
});

describe('BaseSwitchAccessory', () => {
  let platform: TfiacPlatform;
  let accessory: PlatformAccessory;
  let mockService: any;

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock platform
    platform = {
      Service: { Switch: jest.fn() },
      Characteristic: { Name: 'Name', On: 'On' },
      log: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    } as unknown as TfiacPlatform;
    // Mock accessory and service
    mockService = {
      setCharacteristic: jest.fn().mockReturnThis(),
      getCharacteristic: jest.fn().mockReturnValue({ on: jest.fn().mockReturnThis() }),
      updateCharacteristic: jest.fn(),
    };
    accessory = {
      context: { deviceConfig: { ip: '1.2.3.4', port: 1234, updateInterval: 1 } },
      getServiceById: jest.fn().mockReturnValue(null),
      getService: jest.fn().mockReturnValue(null),
      addService: jest.fn().mockReturnValue(mockService),
      removeService: jest.fn(),
    } as unknown as PlatformAccessory;
  });

  // Dummy subclass exposing protected methods
  class TestSwitch extends BaseSwitchAccessory {
    constructor() {
      super(
        platform,
        accessory,
        'TestService',
        'testSub',
        'opt_eco',             // use real status key
        async () => {/*no-op*/},
        'TestLog',
      );
    }
    public testStartPolling() { this.startPolling(); }
    public testStopPolling() { this.stopPolling(); }
    public testUpdateCachedStatus() { return this.updateCachedStatus(); }
    public testHandleGet(cb: any) { this.handleGet(cb); }
    public testHandleSet(value: any, cb: any) { this.handleSet(value, cb); }
  }

  // Subclass to simulate error in API set
  class ErrorSwitch extends BaseSwitchAccessory {
    constructor() {
      super(
        platform,
        accessory,
        'ErrorService',
        'errSub',
        'opt_eco',
        async () => { throw new Error('setFail'); },
        'ErrLog',
      );
    }
    public testHandleSet(value: any, cb: any) { return this.handleSet(value, cb); }
  }

  it('initializes service and handlers', () => {
    const inst = new TestSwitch();
    // addService should be called
    expect(accessory.addService).toHaveBeenCalledWith(
      platform.Service.Switch,
      'TestService',
      'testSub',
    );
    expect(mockService.setCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.Name,
      'TestService',
    );
    // Check getCharacteristic and on handlers
    expect(mockService.getCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.On,
    );
    const getChar = mockService.getCharacteristic();
    expect(getChar.on).toHaveBeenCalledWith('get', expect.any(Function));
    expect(getChar.on).toHaveBeenCalledWith('set', expect.any(Function));
  });

  it('uses existing service by subtype if available', () => {
    const existingService = {
      setCharacteristic: jest.fn().mockReturnThis(),
      getCharacteristic: jest.fn().mockReturnThis(),
      on: jest.fn().mockReturnThis(),
      updateCharacteristic: jest.fn(),
    } as any;
    (accessory.getServiceById as jest.Mock).mockReturnValueOnce(existingService);
    // Ensure other getters are not used
    (accessory.getService as jest.Mock).mockClear();
    (accessory.addService as jest.Mock).mockClear();

    const inst = new TestSwitch();
    expect(accessory.getServiceById).toHaveBeenCalledWith(
      platform.Service.Switch.UUID,
      'testSub',
    );
    expect(accessory.getService).not.toHaveBeenCalled();
    expect(accessory.addService).not.toHaveBeenCalled();
    expect(existingService.setCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.Name,
      'TestService',
    );
  });

  it('uses existing service by name if subtype not available', () => {
    const existingService = {
      setCharacteristic: jest.fn().mockReturnThis(),
      getCharacteristic: jest.fn().mockReturnThis(),
      on: jest.fn().mockReturnThis(),
      updateCharacteristic: jest.fn(),
    } as any;
    (accessory.getServiceById as jest.Mock).mockReturnValueOnce(null);
    (accessory.getService as jest.Mock).mockReturnValueOnce(existingService);
    (accessory.addService as jest.Mock).mockClear();

    const inst = new TestSwitch();
    expect(accessory.getServiceById).toHaveBeenCalled();
    expect(accessory.getService).toHaveBeenCalledWith('TestService');
    expect(accessory.addService).not.toHaveBeenCalled();
    expect(existingService.setCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.Name,
      'TestService',
    );
  });

  it('startPolling logs startup and skips when already started', () => {
    const inst = new TestSwitch();
    // First start
    updateStateMock.mockResolvedValue({ opt_eco: 'on' });
    inst.testStartPolling();
    expect(platform.log.debug).toHaveBeenCalledWith(
      expect.stringContaining('Starting polling for TestLog'),
    );
    // Simulate interval set
    inst['pollingInterval'] = setInterval(() => {}, 1000);
    (platform.log.debug as jest.Mock).mockClear();
    inst.testStartPolling();
    expect(platform.log.debug).toHaveBeenCalledWith(
      `Polling already started for TestLog on ${accessory.displayName}.`,
    );
  });

  it('stopPolling clears interval and handles already stopped', () => {
    const inst = new TestSwitch();
    // Case: has pollingInterval
    const id = setInterval(() => {}, 1000);
    inst['pollingInterval'] = id as any;
    inst.testStopPolling();
    expect(platform.log.debug).toHaveBeenCalledWith(
      `Stopping polling for TestLog on ${accessory.displayName}.`,
    );
    expect(cleanupMock).toHaveBeenCalled();
    expect(inst['pollingInterval']).toBeNull();
    // Case: already stopped
    (platform.log.debug as jest.Mock).mockClear();
    inst.testStopPolling();
    expect(platform.log.debug).toHaveBeenCalledWith(
      `Polling already stopped for TestLog on ${accessory.displayName}.`,
    );
  });

  it('updateCachedStatus skips when polling in progress', async () => {
    const inst = new TestSwitch();
    const debugMock = platform.log.debug as jest.MockedFunction<typeof platform.log.debug>;
    debugMock.mockClear();
    inst['isPolling'] = true;
    await inst.testUpdateCachedStatus();
    expect(debugMock).toHaveBeenCalledWith(
      `Polling already in progress for TestLog on ${accessory.displayName}, skipping.`,
    );
    // updateState should not be called
    expect(updateStateMock).not.toHaveBeenCalled();
  });

  it('updateCachedStatus updates when status changes', async () => {
    const inst = new TestSwitch();
    updateStateMock.mockResolvedValue({ opt_eco: 'on' });
    inst['cachedStatus'] = null;
    await inst.testUpdateCachedStatus();
    expect(platform.log.info).toHaveBeenCalledWith(
      `Updating TestLog characteristic for ${accessory.displayName} to true`,
    );
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.On,
      true,
    );
  });

  it('updateCachedStatus warns on undefined key present', async () => {
    const inst = new TestSwitch();
    // statusKey in status but undefined
    updateStateMock.mockResolvedValue({ opt_eco: undefined });
    await inst.testUpdateCachedStatus();
    expect(platform.log.warn).toHaveBeenCalledWith(
      `Status key 'opt_eco' has undefined value in API response for TestLog on ${accessory.displayName}.`,
    );
  });

  it('updateCachedStatus logs debug when key absent', async () => {
    const inst = new TestSwitch();
    // key absent
    updateStateMock.mockResolvedValue({ other: 'x' });
    await inst.testUpdateCachedStatus();
    expect(platform.log.debug).toHaveBeenCalledWith(
      `Status key 'opt_eco' not present in API response for TestLog on ${accessory.displayName}.`,
    );
  });

  it('updateCachedStatus logs error on exception', async () => {
    const inst = new TestSwitch();
    const err = new Error('fail');
    updateStateMock.mockRejectedValue(err);
    await inst.testUpdateCachedStatus();
    expect(platform.log.error).toHaveBeenCalledWith(
      `Error updating TestLog status for ${accessory.displayName}:`,
      err,
    );
  });

  it('updateCachedStatus logs debug messages on update', async () => {
    const inst = new TestSwitch();
    const debugMock = platform.log.debug as jest.Mock;
    debugMock.mockClear();
    updateStateMock.mockResolvedValue({ opt_eco: 'on' });
    inst['cachedStatus'] = null;
    await inst.testUpdateCachedStatus();
    expect(debugMock).toHaveBeenCalledWith(
      `Updating TestLog status for ${accessory.displayName}...`,
    );
    expect(debugMock).toHaveBeenCalledWith(
      `Received TestLog status for ${accessory.displayName}:`,
      'on',
    );
  });

  it('handleGet returns correct boolean', done => {
    const inst = new TestSwitch();
    // no cache
    inst.testHandleGet((err: any, v?: boolean) => {
      expect(v).toBe(false);
      // with cache on
      inst['cachedStatus'] = { opt_eco: 'on' };
      inst.testHandleGet((e: any, val?: boolean) => {
        expect(val).toBe(true);
        done();
      });
    });
  });

  it('handleGet logs debug message', () => {
    const inst = new TestSwitch();
    const debugMock = platform.log.debug as jest.Mock;
    debugMock.mockClear();
    inst['cachedStatus'] = { opt_eco: 'off' };
    inst.testHandleGet(() => {});
    expect(debugMock).toHaveBeenCalledWith(
      `Get TestLog: Returning false (Cached: off)`,
    );
  });

  it('handleSet succeeds and updates characteristic', async () => {
    const inst = new TestSwitch();
    const cb = jest.fn();
    // initial cachedStatus null
    await inst.testHandleSet(true, cb);
    expect((platform.log.info as jest.Mock)).toHaveBeenCalledWith(
      `Set TestLog: Received request to turn on for ${accessory.displayName}`,
    );
    expect((platform.log.info as jest.Mock)).toHaveBeenCalledWith(
      `TestLog successfully set to on for ${accessory.displayName}`,
    );
    expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
      platform.Characteristic.On,
      true,
    );
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('handleSet error path invokes callback with error', async () => {
    const errInst = new ErrorSwitch();
    const cb = jest.fn();
    await errInst.testHandleSet(false, cb);
    expect((platform.log.error as jest.Mock)).toHaveBeenCalledWith(
      `Error setting ErrLog to off for ${accessory.displayName}:`,
      expect.any(Error),
    );
    expect(cb).toHaveBeenCalledWith(expect.any(Error));
  });
});
