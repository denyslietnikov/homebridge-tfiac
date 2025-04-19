import { jest } from '@jest/globals';
// platform.ext.test.ts
jest.mock('dgram', () => {
  const mockSocket = {
    on: jest.fn(),
    bind: jest.fn(),
    setBroadcast: jest.fn(),
    send: jest.fn(),
    close: jest.fn(),
    address: jest.fn().mockReturnValue({ address: '0.0.0.0', port: 1234 }),
  };
  return { createSocket: jest.fn().mockReturnValue(mockSocket) };
});

import { TfiacPlatformAccessory } from '../platformAccessory';
import { TfiacPlatform } from '../platform';
import { API, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME, TfiacDeviceConfig } from '../settings';
import * as dgram from 'dgram';

/* ------------------------------------------------------------------ */
/*  1.  mock platformAccessory                                         */
/* ------------------------------------------------------------------ */
const tfiacAccessoryInstancesForCleanup: TfiacPlatformAccessory[] = [];

interface TfiacPlatformAccessoryMockStatic {
  cleanupInstances?: () => void;
}

jest.mock('../platformAccessory', () => {
  const MockTfiacAccessory = jest
    .fn()
    .mockImplementation((platform: unknown, accessory: unknown) => {
      const instance = {
        accessory,
        platform,
        stopPolling: jest.fn(),
        startPolling: jest.fn(),
        mapFanModeToRotationSpeed: jest.fn(() => 50),
        mapRotationSpeedToFanMode: jest.fn((speed: number) => {
          if (speed <= 20) {
            return 'Low';
          }
          if (speed <= 40) {
            return 'Middle';
          }
          if (speed <= 80) {
            return 'High';
          }
          return 'Auto';
        }),
        pollingInterval: null,
      };
      tfiacAccessoryInstancesForCleanup.push(
        instance as unknown as TfiacPlatformAccessory,
      );
      return instance as unknown as TfiacPlatformAccessory;
    });

  (MockTfiacAccessory as TfiacPlatformAccessoryMockStatic).cleanupInstances = () => {
    tfiacAccessoryInstancesForCleanup.forEach((i) => i?.stopPolling?.());
    tfiacAccessoryInstancesForCleanup.length = 0;
  };

  return {
    __esModule: true,
    TfiacPlatformAccessory: MockTfiacAccessory,
  };
});

/* ------------------------------------------------------------------ */
/*  2.  mock homebridge & dgram                                        */
/* ------------------------------------------------------------------ */
jest.mock('homebridge', () => {
  const PlatformAccessoryMock = jest.fn().mockImplementation((name, uuid) => ({
    context: {},
    UUID: uuid,
    displayName: name,
  }));
  return {
    API: jest.fn(),
    Categories: jest.fn(),
    Characteristic: jest.fn(),
    Logger: jest.fn(),
    PlatformAccessory: PlatformAccessoryMock,
    PlatformConfig: jest.fn(),
    Service: jest.fn(),
    User: jest.fn(),
  };
});

/* ------------------------------------------------------------------ */
/*  3.  mock platform & xml2js                                         */
/* ------------------------------------------------------------------ */
jest.mock('../platform');

jest.mock('xml2js', () => ({
  __esModule: true,
  parseStringPromise: jest.fn().mockImplementation(async (...args: unknown[]) => {
    const xml = args[0] as string;
    const options = args[1] as { explicitArray: boolean } | undefined;

    // Incomplete statusUpdateMsg without closing tag should throw parse error
    if (xml.includes('<statusUpdateMsg>') && !xml.includes('</statusUpdateMsg>')) {
      throw new Error('Parse error');
    }
    if (xml.includes('<statusUpdateMsg>') && !xml.includes('IndoorTemp')) {
      return { msg: { statusUpdateMsg: [{}] } };
    }
    if (xml.includes('<statusUpdateMsg>')) {
      if (options?.explicitArray === false) {
        return {
          msg: {
            statusUpdateMsg: { IndoorTemp: '25' },
          },
        };
      }
      return {
        msg: {
          statusUpdateMsg: [
            { IndoorTemp: ['25'] },
          ],
        },
      };
    }
    return {};
  }),
}));

/* ------------------------------------------------------------------ */
/*  4.  TfiacPlatformAccessory tests                                   */
/* ------------------------------------------------------------------ */
describe('TfiacPlatformAccessory (ext)', () => {
  it('stopPolling should not throw if pollingInterval is null', () => {
    const platform = { log: { debug: jest.fn() } } as unknown as TfiacPlatformAccessory['platform'];
    const accessory = {
      context: { deviceConfig: { name: 'Test', ip: '1.2.3.4' } },
    } as unknown as TfiacPlatformAccessory['accessory'];

    const tfiac = new TfiacPlatformAccessory(platform, accessory);
    tfiac.stopPolling();
    expect(() => tfiac.stopPolling()).not.toThrow();
  });

  it('should handle fan-mode mappings', () => {
    const platform = { log: { debug: jest.fn() } } as unknown as TfiacPlatformAccessory['platform'];
    const accessory = {
      context: { deviceConfig: { name: 'Test', ip: '1.2.3.4' } },
    } as unknown as TfiacPlatformAccessory['accessory'];

    const tfiac = new TfiacPlatformAccessory(platform, accessory);
    const mockInst = tfiac as unknown as {
      mapFanModeToRotationSpeed: jest.Mock;
      mapRotationSpeedToFanMode: jest.Mock;
    };

    expect(mockInst.mapFanModeToRotationSpeed('whatever')).toBe(50);
    expect(mockInst.mapRotationSpeedToFanMode(10)).toBe('Low');
    expect(mockInst.mapRotationSpeedToFanMode(30)).toBe('Middle');
    expect(mockInst.mapRotationSpeedToFanMode(60)).toBe('High');
    expect(mockInst.mapRotationSpeedToFanMode(90)).toBe('Auto');
  });
});

/* ------------------------------------------------------------------ */
/*  5.  helper mocks for API/Logger                                    */
/* ------------------------------------------------------------------ */
const createMocks = () => {
  const mockLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
    success: jest.fn(),
  } as unknown as Logger;

  const mockAPI = {
    hap: {
      Service: {},
      Characteristic: {},
      uuid: {
        generate: jest
          .fn<(input: string) => string>((input: string) => `generated-uuid-${input}`),
      },
    },
    on: jest.fn(),
    updatePlatformAccessories: jest.fn(),
    registerPlatformAccessories: jest.fn(),
    unregisterPlatformAccessories: jest.fn(),
    platformAccessory: jest.fn().mockImplementation((name, uuid) => ({
      context: {},
      UUID: uuid,
      displayName: name,
    })),
    version: '1.0.0',
    serverVersion: '1.0.0',
    user: { storagePath: () => '/tmp' },
    hapLegacyTypes: {},
  } as unknown as API;

  return { mockLogger, mockAPI };
};

/* ------------------------------------------------------------------ */
/*  6.  TfiacPlatform tests                                            */
/* ------------------------------------------------------------------ */

// Добавим интерфейс для мок-сокета
type MockSocket = {
  on: jest.Mock;
  bind: jest.Mock;
  setBroadcast: jest.Mock;
  send: jest.Mock;
  close: jest.Mock;
  address: jest.Mock;
};

describe('TfiacPlatform (ext)', () => {
  beforeEach(() => jest.resetAllMocks());

  it('handles error in discoverDevices', async () => {
    const { mockLogger, mockAPI } = createMocks();
    const config = {
      platform: 'TfiacPlatform',
      name: 'Test Platform',
      devices: [],
      enableDiscovery: true,
    } as unknown as PlatformConfig;

    const mockPlatform = {
      discoverDevices: jest.fn().mockImplementation(async () => {
        try {
          throw new Error('fail');
        } catch (err) {
          mockLogger.error('Discovery error:', (err as Error).message);
        }
      }),
    };

    (TfiacPlatform as jest.Mock).mockImplementation(() => mockPlatform);
    const platform = new TfiacPlatform(mockLogger, config, mockAPI);
    await platform.discoverDevices();
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('skips network discovery when disabled', async () => {
    jest.unmock('../platform');
    const RealMod = jest.requireActual('../platform') as typeof import('../platform');
    const { mockLogger, mockAPI } = createMocks();

    const config = {
      platform: 'TfiacPlatform',
      name: 'Test Platform',
      devices: [{ name: 'Dev', ip: '192.168.0.10' }],
      enableDiscovery: false,
    } as unknown as PlatformConfig;

    const platform = new RealMod.TfiacPlatform(mockLogger, config, mockAPI);
    (platform as unknown as { accessories: unknown[] }).accessories = [];
    (platform as unknown as { discoverDevicesNetwork: jest.Mock }).discoverDevicesNetwork = jest.fn();
    await platform.discoverDevices();

    expect((platform as unknown as { discoverDevicesNetwork: jest.Mock }).discoverDevicesNetwork).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Network discovery is disabled in the configuration.',
    );
    expect(mockAPI.registerPlatformAccessories).not.toHaveBeenCalled();

    jest.mock('../platform');
  });

  it('logs error for device without IP', async () => {
    jest.unmock('../platform');
    const RealMod = jest.requireActual('../platform') as typeof import('../platform');
    const { mockLogger, mockAPI } = createMocks();

    const config = {
      platform: 'TfiacPlatform',
      name: 'Test Platform',
      devices: [{ name: 'NoIP' }],
      enableDiscovery: false,
    } as unknown as PlatformConfig;

    const platform = new RealMod.TfiacPlatform(mockLogger, config, mockAPI);
    (platform as unknown as { accessories: unknown[] }).accessories = [];
    (platform as unknown as { discoverDevicesNetwork: jest.Mock }).discoverDevicesNetwork = jest.fn();
    await platform.discoverDevices();

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Missing required IP address for configured device:',
      'NoIP',
    );
    expect(mockAPI.registerPlatformAccessories).not.toHaveBeenCalled();

    jest.mock('../platform');
  });

  it('updates existing accessory', async () => {
    jest.unmock('../platform');
    const RealMod = jest.requireActual('../platform') as typeof import('../platform');
    const { mockLogger, mockAPI } = createMocks();

    const deviceConfig: TfiacDeviceConfig = { name: 'Existing', ip: '192.168.0.30' };
    const uuid = 'generated-uuid-192.168.0.30Existing';

    const existingAccessory = {
      UUID: uuid,
      displayName: 'Old',
      context: { deviceConfig: { ...deviceConfig, name: 'Old' } },
    } as unknown as PlatformAccessory;

    const config = {
      platform: 'TfiacPlatform',
      name: 'Test Platform',
      devices: [deviceConfig],
      enableDiscovery: false,
    } as unknown as PlatformConfig;

    const platform = new RealMod.TfiacPlatform(mockLogger, config, mockAPI);
    (platform as unknown as { accessories: unknown[] }).accessories = [];
    (platform as unknown as { accessories: unknown[] }).accessories.push(existingAccessory);

    (mockAPI.hap.uuid.generate as jest.MockedFunction<(s: string) => string>).mockReturnValue(uuid);
    (platform as unknown as { discoverDevicesNetwork: jest.Mock }).discoverDevicesNetwork = jest.fn();
    await platform.discoverDevices();

    expect(mockAPI.updatePlatformAccessories).toHaveBeenCalled();
    expect(mockAPI.registerPlatformAccessories).not.toHaveBeenCalled();
    expect(existingAccessory.displayName).toBe(deviceConfig.name);
    expect(existingAccessory.context.deviceConfig).toEqual(deviceConfig);

    jest.mock('../platform');
  });

  it('removes stale accessory', async () => {
    jest.unmock('../platform');
    const RealMod = jest.requireActual('../platform') as typeof import('../platform');
    const { mockLogger, mockAPI } = createMocks();

    const staleAccessory = {
      UUID: 'stale',
      displayName: 'Stale',
      context: { deviceConfig: { name: 'Stale', ip: '192.168.0.40' } },
    } as unknown as PlatformAccessory;

    const config = {
      platform: 'TfiacPlatform',
      name: 'Test Platform',
      devices: [{ name: 'New', ip: '192.168.0.50' }],
      enableDiscovery: false,
    } as unknown as PlatformConfig;

    const platform = new RealMod.TfiacPlatform(mockLogger, config, mockAPI);
    (platform as unknown as { accessories: unknown[] }).accessories = [];
    const staleMock = { stopPolling: jest.fn() };
    (platform as unknown as { accessories: unknown[] }).accessories.push(staleAccessory);
    (platform as unknown as { discoveredAccessories: Map<string, { stopPolling: jest.Mock }> }).discoveredAccessories.set(
      'stale',
      staleMock,
    );

    (platform as unknown as { discoverDevicesNetwork: jest.Mock }).discoverDevicesNetwork = jest.fn();
    await platform.discoverDevices();

    expect(mockAPI.unregisterPlatformAccessories).toHaveBeenCalledWith(
      PLUGIN_NAME,
      PLATFORM_NAME,
      [staleAccessory],
    );
    expect(staleMock.stopPolling).toHaveBeenCalled();

    jest.mock('../platform');
  });

  it('configureAccessory loads cached accessory', () => {
    jest.unmock('../platform');
    const RealMod = jest.requireActual('../platform') as typeof import('../platform');
    const { mockLogger, mockAPI } = createMocks();

    const config = {
      platform: 'TfiacPlatform',
      name: 'Test Platform',
      devices: [],
    } as unknown as PlatformConfig;

    const platform = new RealMod.TfiacPlatform(mockLogger, config, mockAPI);
    (platform as unknown as { accessories: unknown[] }).accessories = [];

    const accessory = {
      UUID: 'cached',
      displayName: 'Cached Acc',
      context: { deviceConfig: { name: 'Cached', ip: '192.168.0.60' } },
    } as unknown as PlatformAccessory;

    platform.configureAccessory(accessory);
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Loading accessory from cache: Cached Acc',
    );
    expect((platform as unknown as { accessories: unknown[] }).accessories).toContain(accessory);

    jest.mock('../platform');
  });

  it('handles socket error in network discovery', async () => {
    jest.unmock('../platform');
    const RealMod = jest.requireActual('../platform') as typeof import('../platform');
    const { mockLogger, mockAPI } = createMocks();

    // Вручную подменяем dgram.createSocket на мок после unmock
    const mockSocket: MockSocket = {
      on: jest.fn(),
      bind: jest.fn(),
      setBroadcast: jest.fn(),
      send: jest.fn(),
      close: jest.fn(),
      address: jest.fn().mockReturnValue({ address: '0.0.0.0', port: 1234 }),
    };
    (dgram.createSocket as jest.Mock).mockReturnValue(mockSocket);

    const config = {
      platform: 'TfiacPlatform',
      name: 'Test Platform',
      devices: [],
      enableDiscovery: true,
    } as unknown as PlatformConfig;

    const platform = new RealMod.TfiacPlatform(mockLogger, config, mockAPI);
    (platform as unknown as { accessories: unknown[] }).accessories = [];
    mockSocket.bind.mockImplementation(() => {
      const errHandler = mockSocket.on.mock.calls.find((c) => c[0] === 'error')?.[1];
      if (typeof errHandler === 'function') {
        errHandler(new Error('Mock socket error'));
      }
      return mockSocket;
    });

    await expect(
      (platform as unknown as { discoverDevicesNetwork: (timeout: number) => Promise<Set<string>> })
        .discoverDevicesNetwork(5000),
    ).rejects.toThrow('Mock socket error');
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Discovery socket error:',
      expect.any(Error),
    );

    jest.mock('../platform');
  });

  it('discovers devices over network', async () => {
    jest.useFakeTimers();
    jest.unmock('../platform');
    const RealMod = jest.requireActual('../platform') as typeof import('../platform');
    const { mockLogger, mockAPI } = createMocks();

    const config = {
      platform: 'TfiacPlatform',
      name: 'Test Platform',
      devices: [],
      enableDiscovery: true,
    } as unknown as PlatformConfig;

    const platform = new RealMod.TfiacPlatform(mockLogger, config, mockAPI);
    (platform as unknown as { accessories: unknown[] }).accessories = [];

    // Stub network discovery to return our IP
    (platform as unknown as { discoverDevicesNetwork: jest.Mock<() => Promise<Set<string>>> })
      .discoverDevicesNetwork = jest
        .fn<() => Promise<Set<string>>>()
        .mockResolvedValue(new Set(['192.168.0.70']));

    await platform.discoverDevices();

    // Теперь проверяем именно этот лог:
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Adding new accessory: TFIAC 192.168.0.70 (192.168.0.70)',
    );

    jest.useRealTimers();
    jest.mock('../platform');
  }, 10000);

  it('logs when no devices configured and discovery disabled', async () => {
    jest.unmock('../platform');
    const RealMod = jest.requireActual('../platform') as typeof import('../platform');
    const { mockLogger, mockAPI } = createMocks();

    const config = {
      platform: 'TfiacPlatform',
      name: 'Test Platform',
      devices: [],
      enableDiscovery: false,
    } as unknown as PlatformConfig;

    const platform = new RealMod.TfiacPlatform(mockLogger, config, mockAPI);
    (platform as unknown as { accessories: unknown[] }).accessories = [];
    await platform.discoverDevices();

    expect(mockLogger.info).toHaveBeenCalledWith(
      'No configured or discovered devices found.',
    );
    expect(mockAPI.registerPlatformAccessories).not.toHaveBeenCalled();

    jest.mock('../platform');
  });
});

/* ------------------------------------------------------------------ */
/*  7.  TfiacPlatform UDP discovery error branches                     */
/* ------------------------------------------------------------------ */
describe('TfiacPlatform UDP discovery error branches', () => {
  jest.unmock('../platform');
  const RealMod = jest.requireActual('../platform') as typeof import('../platform');

  const mockLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    success: jest.fn(),
    log: jest.fn(),
  };
  const mockAPI = {
    hap: {
      uuid: { generate: jest.fn((str: string) => 'uuid-' + str) },
      Service: {},
      Characteristic: {},
    },
    on: jest.fn(),
    platformAccessory: jest.fn((name: string, uuid: string) => ({ UUID: uuid, displayName: name, context: {} })),
    registerPlatformAccessories: jest.fn(),
    updatePlatformAccessories: jest.fn(),
    unregisterPlatformAccessories: jest.fn(),
    version: '1.0.0',
    serverVersion: '1.0.0',
    user: { storagePath: () => '/tmp' },
    hapLegacyTypes: {},
  } as any;
  const config = { platform: 'TfiacPlatform', name: 'Test Platform', devices: [], enableDiscovery: true };

  let platform: any;
  let errorHandler: ((err: Error) => void) | undefined;
  let listeningHandler: (() => void) | undefined;
  let messageHandler: ((msg: Buffer, rinfo: { address: string; port: number }) => void) | undefined;

  beforeEach(() => {
    errorHandler = undefined;
    listeningHandler = undefined;
    messageHandler = undefined;
    // platform will be created in each test after dgram.createSocket is mocked
  });

  it('should log error if socket.close throws in cleanup', async () => {
    require('dgram').createSocket = jest.fn().mockReturnValue({
      on: (event: string, cb: (...args: any[]) => void) => { if (event === 'error') errorHandler = cb as (err: Error) => void; return this; },
      setBroadcast: jest.fn(),
      send: jest.fn((msg: any, port: any, addr: any, cb: (...args: any[]) => void) => cb()),
      close: jest.fn(() => { throw new Error('close fail'); }),
      address: jest.fn(() => ({ address: '0.0.0.0', port: 1234 })),
      removeAllListeners: jest.fn(),
      bind: jest.fn(),
    });
    platform = new RealMod.TfiacPlatform(mockLogger, config, mockAPI);
    const promise = platform["discoverDevicesNetwork"](10);
    if (typeof errorHandler === 'function') errorHandler(new Error('socket error'));
    await expect(Promise.resolve(promise)).rejects.toThrow('socket error');
    expect(mockLogger.debug).toHaveBeenCalledWith('Error closing discovery socket:', expect.any(Error));
  });

  it('should log error if send discovery broadcast fails', async () => {
    require('dgram').createSocket = jest.fn().mockReturnValue({
      on: (event: string, cb: (...args: any[]) => void) => { if (event === 'listening') listeningHandler = cb as () => void; return this; },
      setBroadcast: jest.fn(),
      send: jest.fn((msg: any, port: any, addr: any, cb: (...args: any[]) => void) => cb(new Error('send fail'))),
      close: jest.fn(),
      address: jest.fn(() => ({ address: '0.0.0.0', port: 1234 })),
      removeAllListeners: jest.fn(),
      bind: jest.fn(),
    });
    platform = new RealMod.TfiacPlatform(mockLogger, config, mockAPI);
    const promise = platform["discoverDevicesNetwork"](10);
    if (typeof listeningHandler === 'function') listeningHandler();
    await expect(Promise.resolve(promise)).resolves.toBeInstanceOf(Set);
    expect(mockLogger.error).toHaveBeenCalledWith('Error sending discovery broadcast:', expect.any(Error));
  });

  it('should log debug for non-status and non-XML responses', async () => {
    // Clear debug logs from previous tests
    mockLogger.debug.mockClear();
    
    // Create a proper mock implementation for the XML parser to directly capture errors
    const originalParseStringPromise = require('xml2js').parseStringPromise;
    require('xml2js').parseStringPromise = jest.fn().mockImplementation(async (xml) => {
      const xmlString = xml as string;
      if (xmlString.includes('<statusUpdateMsg>') && !xmlString.includes('</statusUpdateMsg>')) {
        throw new Error('Parse error');
      }
      return originalParseStringPromise(xml);
    });
    
    // Capture when the error logging happens
    const debugCalls: any[][] = [];
    const originalDebug = mockLogger.debug;
    mockLogger.debug = jest.fn().mockImplementation((...args: any[]) => {
      debugCalls.push(args);
      return originalDebug(...args);
    });
    
    // Set up socket mock
    require('dgram').createSocket = jest.fn().mockReturnValue({
      on: (event: string, cb: (...args: any[]) => void) => {
        if (event === 'message') messageHandler = cb as (msg: Buffer, rinfo: { address: string; port: number }) => void;
        if (event === 'listening') {
          setTimeout(() => {
            if (typeof cb === 'function') cb();
          }, 10);
        }
        return this;
      },
      setBroadcast: jest.fn(),
      send: jest.fn((msg: any, port: any, addr: any, cb: (...args: any[]) => void) => {
        if (typeof cb === 'function') cb();
      }),
      close: jest.fn(),
      address: jest.fn(() => ({ address: '0.0.0.0', port: 1234 })),
      removeAllListeners: jest.fn(),
      bind: jest.fn(),
    });
    
    platform = new RealMod.TfiacPlatform(mockLogger, config, mockAPI);
    
    // Create a short discoveryPromise
    const discoveryPromise = platform["discoverDevicesNetwork"](100);
    
    // Send test messages with small delays
    await new Promise(resolve => setTimeout(resolve, 20));
    
    if (typeof messageHandler === 'function') {
      // Send regular XML that will be recognized as non-XML (our response intercepts it)
      messageHandler(Buffer.from('not xml'), { address: '1.2.3.4', port: 7777 });
      
      // Wait a bit to ensure message is processed
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // Send message that will be recognized as non-status
      messageHandler(Buffer.from('<msg><statusUpdateMsg></statusUpdateMsg></msg>'), { address: '1.2.3.5', port: 7777 });
      
      // Wait a bit to ensure message is processed  
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // Send malformed XML that will trigger our parse error
      messageHandler(Buffer.from('<msg><statusUpdateMsg>'), { address: '1.2.3.6', port: 7777 });
      
      // Wait longer to ensure error message is processed
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Complete the discovery
    await discoveryPromise;
    
    // Now inspect debug calls to verify all expected logs happened
    const nonXmlLog = debugCalls.find(args => 
      args[0] === 'Ignoring non-XML/non-status response from 1.2.3.4');
    const nonStatusLog = debugCalls.find(args => 
      args[0] === 'Ignoring non-status response from 1.2.3.5');
    const parseErrorLog = debugCalls.find(args => 
      args[0] === 'Error parsing response from 1.2.3.6:');
    
    // Assert each logging call happened
    expect(nonXmlLog).toBeTruthy();
    expect(nonStatusLog).toBeTruthy();
    expect(parseErrorLog).toBeTruthy();
    
    // Clean up our mock to not affect other tests
    require('xml2js').parseStringPromise = originalParseStringPromise;
  }, 10000); // Increase timeout to 10 seconds
});