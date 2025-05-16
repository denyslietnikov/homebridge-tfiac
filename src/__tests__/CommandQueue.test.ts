import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CommandQueue } from '../state/CommandQueue';
import { DeviceState } from '../state/DeviceState';
import { FanSpeed, PowerState, OperationMode } from '../enums';

// Mock API with setDeviceOptions and updateState
const createMockApi = () => ({
  setDeviceOptions: vi.fn().mockResolvedValue(undefined),
  updateState: vi.fn().mockResolvedValue({}),
});
const createMockLogger = () => ({ info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() });

describe('CommandQueue', () => {
  let mockApi: any;
  let deviceState: DeviceState;
  let logger: any;
  let queue: CommandQueue;

  beforeEach(() => {
    mockApi = createMockApi();
    deviceState = new DeviceState();
    logger = createMockLogger();
    queue = new CommandQueue(mockApi, deviceState, logger as any, 0);
    // Prevent unhandled 'error' events from bubbling and crashing tests
    queue.on('error', () => {});
    vi.useRealTimers();
  });

  it('should execute a single command', async () => {
    const result = await queue.enqueueCommand({ temp: 25 });
    expect(mockApi.setDeviceOptions).toHaveBeenCalledWith({ temp: 25 });
    expect(result).toBeUndefined();
  });

  it('should merge commands within merge window', async () => {
    // Reset the mock to ensure clean state
    mockApi.setDeviceOptions.mockClear();
    
    // Create a synchronous version that will ensure commands are enqueued before processing
    vi.spyOn(queue, 'processQueue' as any).mockImplementationOnce(async () => {
      // Do nothing - this will prevent the first command from being processed immediately
      // allowing the second command to merge with it
    });
    
    // Enqueue first command
    const p1 = queue.enqueueCommand({ temp: 20 });
    
    // Immediately enqueue another that should merge
    const p2 = queue.enqueueCommand({ fanSpeed: FanSpeed.High });
    
    // Now manually trigger processing
    await (queue as any).processQueue();
    
    // Wait for both promises to resolve
    await Promise.all([p1, p2]);
    
    // Only one API call with merged options
    expect(mockApi.setDeviceOptions).toHaveBeenCalledTimes(1);
    expect(mockApi.setDeviceOptions).toHaveBeenCalledWith({ temp: 20, fanSpeed: FanSpeed.High });
  });

  it('should emit executed event', async () => {
    const executedSpy = vi.fn();
    queue.on('executed', executedSpy);
    await queue.enqueueCommand({ power: PowerState.On });
    expect(executedSpy).toHaveBeenCalledWith({ command: { power: PowerState.On } });
  });

  it('should retry on failure and then succeed', async () => {
    vi.useFakeTimers();
    const failErr = new Error('fail');
    mockApi.setDeviceOptions.mockRejectedValueOnce(failErr).mockResolvedValueOnce(undefined);
    const retrySpy = vi.fn();
    queue.on('retry', retrySpy);
    const promise = queue.enqueueCommand({ mode: OperationMode.Heat });
    // advance timers to trigger retry delay
    await vi.runAllTimersAsync();
    await promise;
    expect(retrySpy).toHaveBeenCalled();
    expect(mockApi.setDeviceOptions).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('should emit maxRetriesReached and reject after retries exhausted', async () => {
    const err = new Error('always fail');
    mockApi.setDeviceOptions.mockRejectedValue(err);
    const maxSpy = vi.fn();
    queue.on('maxRetriesReached', maxSpy);
    await expect(queue.enqueueCommand({ temp: 30 })).rejects.toThrow('always fail');
    expect(maxSpy).toHaveBeenCalledWith({ command: { temp: 30 }, error: err });
    expect(mockApi.setDeviceOptions).toHaveBeenCalledTimes(3);
  });

  it('should not merge commands if outside merge window', async () => {
    vi.useFakeTimers();
    const p1 = queue.enqueueCommand({ temp: 20 });
    // advance beyond COMMAND_MERGE_WINDOW_MS (500ms)
    await vi.advanceTimersByTimeAsync(600);
    const p2 = queue.enqueueCommand({ fanSpeed: FanSpeed.High });
    await Promise.all([p1, p2]);
    expect(mockApi.setDeviceOptions).toHaveBeenCalledTimes(2);
    expect(mockApi.setDeviceOptions).toHaveBeenNthCalledWith(1, { temp: 20 });
    expect(mockApi.setDeviceOptions).toHaveBeenNthCalledWith(2, { fanSpeed: FanSpeed.High });
    vi.useRealTimers();
  });

  it('should perform rapid feedback update after execution', async () => {
    vi.useFakeTimers();
    const status = { is_on: PowerState.On } as any;
    mockApi.updateState.mockResolvedValueOnce(status);
    const updateSpy = vi.spyOn(deviceState, 'updateFromDevice');
    const promise = queue.enqueueCommand({ power: PowerState.On });
    await promise;
    // Fast-forward the rapid feedback timer (setTimeout 2000ms)
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockApi.updateState).toHaveBeenCalledWith(true);
    expect(updateSpy).toHaveBeenCalledWith(status);
    vi.useRealTimers();
  });

  it('should not merge commands if outside merge window', async () => {
    vi.useFakeTimers();
    const p1 = queue.enqueueCommand({ temp: 20 });
    // advance beyond merge window of 500ms
    await vi.advanceTimersByTimeAsync(600);
    const p2 = queue.enqueueCommand({ fanSpeed: FanSpeed.High });
    await Promise.all([p1, p2]);
    expect(mockApi.setDeviceOptions).toHaveBeenCalledTimes(2);
    expect(mockApi.setDeviceOptions).toHaveBeenNthCalledWith(1, { temp: 20 });
    expect(mockApi.setDeviceOptions).toHaveBeenNthCalledWith(2, { fanSpeed: FanSpeed.High });
    vi.useRealTimers();
  });

  it('should perform rapid feedback update after execution', async () => {
    vi.useFakeTimers();
    const status = { is_on: PowerState.On } as any;
    mockApi.updateState.mockResolvedValueOnce(status);
    const updateSpy = vi.spyOn(deviceState, 'updateFromDevice');
    const result = await queue.enqueueCommand({ power: PowerState.On });
    expect(result).toBeUndefined();
    // fast-forward rapid-feedback timer (2s)
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockApi.updateState).toHaveBeenCalledWith(true);
    expect(updateSpy).toHaveBeenCalledWith(status);
    vi.useRealTimers();
  });
});

describe('additional CommandQueue scenarios', () => {
  let mockApi: any;
  let deviceState: DeviceState;
  let logger: any;
  let queue: CommandQueue;

  beforeEach(() => {
    mockApi = createMockApi();
    deviceState = new DeviceState();
    logger = createMockLogger();
    queue = new CommandQueue(mockApi, deviceState, logger as any, 0);
    // Prevent unhandled 'error' events from bubbling and crashing tests
    queue.on('error', () => {});
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should not merge commands if outside merge window', async () => {
    // enqueue first command
    const p1 = queue.enqueueCommand({ temp: 20 });
    // advance time beyond merge window
    vi.advanceTimersByTime(600);
    const p2 = queue.enqueueCommand({ fanSpeed: FanSpeed.High });
    await Promise.all([p1, p2]);
    expect(mockApi.setDeviceOptions).toHaveBeenCalledTimes(2);
    expect(mockApi.setDeviceOptions.mock.calls[0][0]).toEqual({ temp: 20 });
    expect(mockApi.setDeviceOptions.mock.calls[1][0]).toEqual({ fanSpeed: FanSpeed.High });
  });

  it('should perform rapid feedback update after execution', async () => {
    const status = { is_on: PowerState.On } as any;
    mockApi.updateState.mockResolvedValueOnce(status);
    const updateSpy = vi.spyOn(deviceState, 'updateFromDevice');

    const promise = queue.enqueueCommand({ power: PowerState.On });
    await promise;
    // fast-forward rapid feedback delay (2s)
    await vi.advanceTimersByTimeAsync(2000);

    expect(mockApi.updateState).toHaveBeenCalledWith(true);
    expect(updateSpy).toHaveBeenCalledWith(status);
  });
});
