// platform.network.discovery.test.ts - Tests specifically for network discovery functionality
import { vi, describe, beforeEach, afterEach, test, expect } from 'vitest';
import { TfiacPlatform } from '../platform.js';
import { API } from 'homebridge';
import * as dgram from 'dgram';
import { createMockLogger, createMockAPI, MockLogger, MockAPI } from './testUtils.js';

// Mock the dgram module
vi.mock('dgram', () => {
  const actualDgram = vi.importActual('dgram');
  return {
    createSocket: vi.fn(),
  };
});

// Mock xml2js
vi.mock('xml2js', () => ({
  parseStringPromise: vi.fn(),
}));

// Helper to create a mock socket with specified behavior
const createMockSocket = (options: {
  onMessage?: Array<{ msg: Buffer; rinfo: dgram.RemoteInfo }>;
  onError?: Error;
  bindError?: Error;
  setBroadcastError?: Error;
  sendError?: Error;
}): any => {
  const mockSocket: any = {
    on: vi.fn((event, callback) => {
      if (event === 'message' && options.onMessage) {
        // Schedule message events to be emitted
        setTimeout(() => {
          options.onMessage!.forEach(item => callback(item.msg, item.rinfo));
        }, 50);
      } else if (event === 'error' && options.onError) {
        setTimeout(() => {
          callback(options.onError);
        }, 50);
      } else if (event === 'listening') {
        setTimeout(() => {
          callback();
        }, 10);
      }
      return mockSocket;
    }),
    bind: vi.fn(() => {
      if (options.bindError) {
        throw options.bindError;
      }
      return undefined;
    }),
    setBroadcast: vi.fn(() => {
      if (options.setBroadcastError) {
        throw options.setBroadcastError;
      }
      return true;
    }),
    send: vi.fn((msg, port, addr, callback) => {
      if (options.sendError) {
        callback(options.sendError);
      } else {
        callback(null);
      }
      return mockSocket;
    }),
    close: vi.fn((callback) => {
      if (callback) {
        callback();
      }
      return mockSocket;
    }),
    address: vi.fn(() => ({ address: '0.0.0.0', port: 12345, family: 'IPv4' })),
  };
  return mockSocket;
};

describe('TfiacPlatform Network Discovery', () => {
  // Use the common mock logger and API from testUtils
  let mockLogger: MockLogger;
  let mockAPI: MockAPI;

  const mockConfig = {
    platform: 'TFIAC',
    name: 'TFIAC',
    devices: [
      {
        name: 'Test AC',
        ip: '192.168.1.100',
      },
    ],
    enableDiscovery: true,
  };

  // Clear all mocks before each test
  beforeEach(() => {
    mockLogger = createMockLogger();
    mockAPI = createMockAPI();
    
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper to create valid TFIAC XML response
  const createValidResponse = (ip = '192.168.1.200') => {
    return Buffer.from(
      `<msg msgid="statusUpdateMsg" type="Control" seq="123456">
        <statusUpdateMsg>
          <IndoorTemp>25</IndoorTemp>
          <OutdoorTemp>30</OutdoorTemp>
          <Power>1</Power>
          <SetTemp>24</SetTemp>
          <Mode>1</Mode>
          <Fan>2</Fan>
          <HSwing>0</HSwing>
          <VSwing>1</VSwing>
          <Turbo>0</Turbo>
          <Eco>0</Eco>
          <Dry>0</Dry>
          <Sleep>0</Sleep>
          <Display>1</Display>
          <Beep>1</Beep>
        </statusUpdateMsg>
      </msg>`
    );
  };

  // Helper to create mock XML2JS parsed result
  const createValidParsedResponse = () => {
    return {
      msg: {
        statusUpdateMsg: [{
          IndoorTemp: ['25'],
          OutdoorTemp: ['30'],
          Power: ['1'],
          SetTemp: ['24'],
          Mode: ['1'],
          Fan: ['2'],
          HSwing: ['0'],
          VSwing: ['1'],
          Turbo: ['0'],
          Eco: ['0'],
          Dry: ['0'],
          Sleep: ['0'],
          Display: ['1'],
          Beep: ['1'],
        }],
      },
    };
  };

  test('should discover devices via network scan', async () => {
    // Setup
    const xml2js = await import('xml2js');
    (xml2js.parseStringPromise as any).mockResolvedValue(createValidParsedResponse());

    const mockSocketInstance = createMockSocket({
      onMessage: [
        {
          msg: createValidResponse('192.168.1.200'),
          rinfo: {
            address: '192.168.1.200',
            port: 7777,
            family: 'IPv4',
            size: 100,
          },
        },
      ],
    });

    (dgram.createSocket as ReturnType<typeof vi.fn>).mockReturnValue(mockSocketInstance);

    // Create platform instance
    const platform = new TfiacPlatform(mockLogger, mockConfig, mockAPI);

    // Access the private method using type assertion
    const discoverDevicesNetwork = (platform as any).discoverDevicesNetwork.bind(platform);

    // Test
    const discoveredIPs = await discoverDevicesNetwork(1000);

    // Expectations
    expect(dgram.createSocket).toHaveBeenCalledWith('udp4');
    expect(mockSocketInstance.on).toHaveBeenCalledWith('message', expect.any(Function));
    expect(mockSocketInstance.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(mockSocketInstance.on).toHaveBeenCalledWith('listening', expect.any(Function));
    expect(mockSocketInstance.bind).toHaveBeenCalled();
    expect(mockSocketInstance.setBroadcast).toHaveBeenCalledWith(true);
    expect(mockSocketInstance.send).toHaveBeenCalled();
    expect(mockSocketInstance.close).toHaveBeenCalled();
    expect(xml2js.parseStringPromise).toHaveBeenCalled();
    expect(discoveredIPs.has('192.168.1.200')).toBe(true);
    expect(discoveredIPs.size).toBe(1);
  }, 30000);

  test('should handle socket errors', async () => {
    // Setup
    const socketError = new Error('Socket error');
    const mockSocketInstance = createMockSocket({
      onError: socketError,
    });

    (dgram.createSocket as ReturnType<typeof vi.fn>).mockReturnValue(mockSocketInstance);

    // Create platform instance
    const platform = new TfiacPlatform(mockLogger, mockConfig, mockAPI);

    // Access the private method using type assertion
    const discoverDevicesNetwork = (platform as any).discoverDevicesNetwork.bind(platform);

    // Test: should resolve to empty set and log error
    const discoveredIPs = await discoverDevicesNetwork(1000);
    expect(discoveredIPs.size).toBe(0);
    expect(mockLogger.error).toHaveBeenCalledWith('Discovery socket error:', socketError);

    // Expectations
    expect(dgram.createSocket).toHaveBeenCalledWith('udp4');
    expect(mockSocketInstance.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(mockSocketInstance.close).toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith('Discovery socket error:', socketError);
  }, 30000);

  test('should handle XML parsing errors', async () => {
    // Setup
    const xml2js = await import('xml2js');
    (xml2js.parseStringPromise as any).mockRejectedValue(new Error('XML parse error'));

    const mockSocketInstance = createMockSocket({
      onMessage: [
        {
          msg: createValidResponse('192.168.1.200'),
          rinfo: {
            address: '192.168.1.200',
            port: 7777,
            family: 'IPv4',
            size: 100,
          },
        },
      ],
    });

    (dgram.createSocket as ReturnType<typeof vi.fn>).mockReturnValue(mockSocketInstance);

    // Create platform instance
    const platform = new TfiacPlatform(mockLogger, mockConfig, mockAPI);

    // Access the private method using type assertion
    const discoverDevicesNetwork = (platform as any).discoverDevicesNetwork.bind(platform);

    // Test
    const discoveredIPs = await discoverDevicesNetwork(1000);

    // Expectations
    expect(xml2js.parseStringPromise).toHaveBeenCalled();
    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Error parsing response from 192.168.1.200:',
      expect.any(Error)
    );
    expect(discoveredIPs.size).toBe(0);
  });

  test('should handle non-status XML responses', async () => {
    // Setup
    const xml2js = await import('xml2js');
    (xml2js.parseStringPromise as any).mockResolvedValue({
      msg: {
        otherMsg: [{ SomeData: ['test'] }],
      },
    });

    const mockSocketInstance = createMockSocket({
      onMessage: [
        {
          msg: Buffer.from('<msg><otherMsg><SomeData>test</SomeData></otherMsg></msg>'),
          rinfo: {
            address: '192.168.1.200',
            port: 7777,
            family: 'IPv4',
            size: 100,
          },
        },
      ],
    });

    (dgram.createSocket as ReturnType<typeof vi.fn>).mockReturnValue(mockSocketInstance);

    // Create platform instance
    const platform = new TfiacPlatform(mockLogger, mockConfig, mockAPI);

    // Access the private method using type assertion
    const discoverDevicesNetwork = (platform as any).discoverDevicesNetwork.bind(platform);

    // Test
    const discoveredIPs = await discoverDevicesNetwork(1000);

    // Expectations
    expect(xml2js.parseStringPromise).not.toHaveBeenCalled();
    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Ignoring non-XML/non-status response from 192.168.1.200',
      expect.any(String)
    );
    expect(discoveredIPs.size).toBe(0);
  });

  test('should handle socket binding errors', async () => {
    // Setup
    const bindError = new Error('Bind error');
    const mockSocketInstance = createMockSocket({
      bindError,
    });

    (dgram.createSocket as ReturnType<typeof vi.fn>).mockReturnValue(mockSocketInstance);

    // Create platform instance
    const platform = new TfiacPlatform(mockLogger, mockConfig, mockAPI);

    // Access the private method using type assertion
    const discoverDevicesNetwork = (platform as any).discoverDevicesNetwork.bind(platform);

    // Test: should resolve to empty set and log setup error
    const discoveredBind = await discoverDevicesNetwork(1000);
    expect(discoveredBind.size).toBe(0);
    expect(mockLogger.error).toHaveBeenCalledWith('Error setting up discovery socket:', bindError);

    // Expectations
    expect(dgram.createSocket).toHaveBeenCalledWith('udp4');
    expect(mockSocketInstance.bind).toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith('Error setting up discovery socket:', bindError);
  }, 30000);

  test('should handle socket setBroadcast errors', async () => {
    // Setup
    const setBroadcastError = new Error('SetBroadcast error');
    const mockSocketInstance = createMockSocket({
      setBroadcastError,
    });

    (dgram.createSocket as ReturnType<typeof vi.fn>).mockReturnValue(mockSocketInstance);

    // Create platform instance
    const platform = new TfiacPlatform(mockLogger, mockConfig, mockAPI);

    // Access the private method using type assertion
    const discoverDevicesNetwork = (platform as any).discoverDevicesNetwork.bind(platform);

    // Test: should resolve to empty set and log broadcast setup error
    const discoveredBroadcast = await discoverDevicesNetwork(1000);
    expect(discoveredBroadcast.size).toBe(0);
    expect(mockLogger.error).toHaveBeenCalledWith('Error setting up broadcast:', setBroadcastError);

    // Expectations
    expect(dgram.createSocket).toHaveBeenCalledWith('udp4');
    expect(mockSocketInstance.bind).toHaveBeenCalled();
    expect(mockSocketInstance.setBroadcast).toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith('Error setting up broadcast:', setBroadcastError);
  }, 30000);

  test('should handle socket send errors', async () => {
    // Setup
    const sendError = new Error('Send error');
    const mockSocketInstance = createMockSocket({
      sendError,
    });

    (dgram.createSocket as ReturnType<typeof vi.fn>).mockReturnValue(mockSocketInstance);

    // Create platform instance
    const platform = new TfiacPlatform(mockLogger, mockConfig, mockAPI);

    // Access the private method using type assertion
    const discoverDevicesNetwork = (platform as any).discoverDevicesNetwork.bind(platform);

    // Test
    const discoveredIPs = await discoverDevicesNetwork(1000);

    // Expectations
    expect(dgram.createSocket).toHaveBeenCalledWith('udp4');
    expect(mockSocketInstance.send).toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith('Error sending discovery broadcast:', sendError);
    expect(discoveredIPs.size).toBe(0);
  }, 30000);

  test('should discover multiple devices', async () => {
    // Setup
    const xml2js = await import('xml2js');
    (xml2js.parseStringPromise as any).mockResolvedValue(createValidParsedResponse());

    const mockSocketInstance = createMockSocket({
      onMessage: [
        {
          msg: createValidResponse('192.168.1.200'),
          rinfo: {
            address: '192.168.1.200',
            port: 7777,
            family: 'IPv4',
            size: 100,
          },
        },
        {
          msg: createValidResponse('192.168.1.201'),
          rinfo: {
            address: '192.168.1.201',
            port: 7777,
            family: 'IPv4',
            size: 100,
          },
        },
      ],
    });

    (dgram.createSocket as ReturnType<typeof vi.fn>).mockReturnValue(mockSocketInstance);

    // Create platform instance
    const platform = new TfiacPlatform(mockLogger, mockConfig, mockAPI);

    // Access the private method using type assertion
    const discoverDevicesNetwork = (platform as any).discoverDevicesNetwork.bind(platform);

    // Test
    const discoveredIPs = await discoverDevicesNetwork(1000);

    // Expectations
    expect(xml2js.parseStringPromise).toHaveBeenCalledTimes(2);
    expect(discoveredIPs.has('192.168.1.200')).toBe(true);
    expect(discoveredIPs.has('192.168.1.201')).toBe(true);
    expect(discoveredIPs.size).toBe(2);
  }, 30000);

  test('should ignore duplicate devices during discovery', async () => {
    // Setup
    const xml2js = await import('xml2js');
    (xml2js.parseStringPromise as any).mockResolvedValue(createValidParsedResponse());

    const mockSocketInstance = createMockSocket({
      onMessage: [
        {
          msg: createValidResponse('192.168.1.200'),
          rinfo: {
            address: '192.168.1.200',
            port: 7777,
            family: 'IPv4',
            size: 100,
          },
        },
        {
          msg: createValidResponse('192.168.1.200'),
          rinfo: {
            address: '192.168.1.200',
            port: 7777,
            family: 'IPv4',
            size: 100,
          },
        },
      ],
    });

    (dgram.createSocket as ReturnType<typeof vi.fn>).mockReturnValue(mockSocketInstance);

    // Create platform instance
    const platform = new TfiacPlatform(mockLogger, mockConfig, mockAPI);

    // Access the private method using type assertion
    const discoverDevicesNetwork = (platform as any).discoverDevicesNetwork.bind(platform);

    // Test
    const discoveredIPs = await discoverDevicesNetwork(1000);

    // Expectations
    expect(xml2js.parseStringPromise).toHaveBeenCalledTimes(2);
    expect(discoveredIPs.has('192.168.1.200')).toBe(true);
    expect(discoveredIPs.size).toBe(1);
    expect(mockLogger.info).toHaveBeenCalledWith('Discovered TFIAC device at 192.168.1.200');
    expect(mockLogger.debug).toHaveBeenCalledWith('Discovery timeout reached.');
  });

  test('should respect discovery timeout', async () => {
    // Setup
    const mockSocketInstance = createMockSocket({});
    (dgram.createSocket as ReturnType<typeof vi.fn>).mockReturnValue(mockSocketInstance);

    // Create platform instance
    const platform = new TfiacPlatform(mockLogger, mockConfig, mockAPI);

    // Access the private method using type assertion
    const discoverDevicesNetwork = (platform as any).discoverDevicesNetwork.bind(platform);

    // Start the discovery process
    const discoveryPromise = discoverDevicesNetwork(1000);

    // Wait for real time (no fake timers)
    await new Promise(res => setTimeout(res, 1100));

    // Test
    const discoveredIPs = await discoveryPromise;

    // Expectations
    expect(discoveredIPs.size).toBe(0);
    expect(mockLogger.debug).toHaveBeenCalledWith('Discovery timeout reached.');
  });
});