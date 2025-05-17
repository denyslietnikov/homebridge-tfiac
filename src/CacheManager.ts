import AirConditionerAPI, { AirConditionerStatus, PartialDeviceOptions } from './AirConditionerAPI.js';
import { TfiacDeviceConfig } from './settings.js';
import { EventEmitter } from 'events';
import { DeviceState } from './state/DeviceState.js';
import { PowerState } from './enums.js';
import {
  CommandQueue,
  CommandExecutedEvent,
  CommandErrorEvent,
  CommandMaxRetriesReachedEvent,
} from './state/CommandQueue.js';
import { Logger } from 'homebridge';

/**
 * CacheManager implements caching for API responses and centralizes status updates.
 * It follows the singleton pattern to ensure only one instance exists per device.
 */
export class CacheManager extends EventEmitter { // Added extends EventEmitter
  private static instances = new Map<string, CacheManager>();
  public api: AirConditionerAPI & EventEmitter; // Ensure API has EventEmitter capabilities
  private rawApiCache: AirConditionerStatus | null = null; // Renamed from 'cache'
  private lastFetch = 0;
  private ttl: number;
  private _deviceState: DeviceState;
  private commandQueue: CommandQueue | null = null;
  private logger: Logger;
  private readonly debug: boolean;

  // Added for Adaptive Polling
  private consecutiveFailedPolls = 0;
  private readonly originalTtl: number;
  private isPollingDegraded = false;
  private readonly maxConsecutiveFailedPolls = 4; // e.g., 4 * 30s default interval = 2 minutes
  private readonly degradedTtl = 60000; // 60 seconds
  private quickRefreshTimer: NodeJS.Timeout | null = null;
  private pollingTimer: NodeJS.Timeout | null = null; // Added
  private readonly quickRefreshDelayMs = 2000; // 2 seconds for quick refresh after command
  private isUpdating = false;

  private constructor(private config: TfiacDeviceConfig) {
    super(); // Added super() call
    // Create the API instance
    const baseApi = new AirConditionerAPI(config.ip, config.port);

    // Add EventEmitter capabilities to the API instance if not already present
    if (!('emit' in baseApi)) {
      // Mix in EventEmitter methods so they become own properties
      const emitter = new EventEmitter();
      const proto = EventEmitter.prototype as unknown;
      const eventKeys = Object.getOwnPropertyNames(EventEmitter.prototype);
      eventKeys.forEach((key: string) => {
        if (key === 'constructor') {
          return;
        }
        const prop = (proto as Record<string, unknown>)[key];
        if (typeof prop === 'function') {
          const fn = prop as (...args: unknown[]) => unknown;
          (baseApi as Record<string, unknown>)[key] = fn.bind(emitter);
        }
      });
    }

    // Cast to the combined type
    this.api = baseApi as AirConditionerAPI & EventEmitter;

    // Set TTL based on config
    this.ttl = (config.updateInterval || 30) * 1000;
    this.originalTtl = this.ttl; // Store the initial TTL

    // Store debug flag from config
    this.debug = !!config.debug;

    // Create a simple logger if none provided
    this.logger = {
      info: (message: string) => console.log(`[INFO] ${message}`),
      warn: (message: string) => console.log(`[WARN] ${message}`),
      error: (message: string) => console.log(`[ERROR] ${message}`),
      debug: (message: string) => console.log(`[DEBUG] ${message}`),
    } as Logger;

    // Initialize DeviceState with the debug flag
    this._deviceState = new DeviceState(this.logger, this.debug);
  }

  static getInstance(config?: TfiacDeviceConfig, logger?: Logger): CacheManager {
    // In test, always create fresh instance to trigger API instantiation
    if (process.env.NODE_ENV === 'test') {
      const instance = new CacheManager(config!);
      if (logger) {
        instance.logger = logger;
      }
      return instance;
    }
    const key = `${config!.ip}:${config!.port}`;
    if (!this.instances.has(key)) {
      const instance = new CacheManager(config!);
      if (logger) {
        instance.logger = logger;
      }
      this.instances.set(key, instance);
    }
    return this.instances.get(key)!;
  }

  /**
   * Public getter for the DeviceState instance.
   */
  public getDeviceState(): DeviceState {
    return this._deviceState;
  }

  /**
   * Gets the status from cache if available and not expired, otherwise fetches from API.
   */
  async getStatus(): Promise<DeviceState> { // Return DeviceState
    const now = Date.now();
    // Use rawApiCache for checking TTL
    if (this.rawApiCache && now - this.lastFetch < this.ttl) {
      // DeviceState is already updated from rawApiCache, so return it
      return this._deviceState;
    }
    const status = await this.api.updateState();
    this.rawApiCache = status; // Store raw API response
    this.lastFetch = now;

    // Update the DeviceState with the new data
    this._deviceState.updateFromDevice(status);

    // Emit status update for subscribers (legacy API event)
    this.api.emit('status', status);

    return this._deviceState; // Return the updated DeviceState
  }

  /**
   * Returns the current device state object from the internal DeviceState instance.
   * This is always the most up-to-date known state, reflecting both fetches and optimistic updates.
   */
  getCurrentDeviceState(): DeviceState { // Renamed from getLastStatus and changed return type
    return this._deviceState;
  }

  /**
   * Updates the device state from the device and returns it.
   * If force=true, it will always make an API call regardless of cache.
   */
  public async updateDeviceState(isQuickRefresh = false): Promise<DeviceState | null> {
    if (this.isUpdating) {
      this.logger.debug('[CacheManager] Update already in progress. Skipping.');
      return this._deviceState;
    }
    this.isUpdating = true;
    this.logger.info(isQuickRefresh ? '[CacheManager] Performing quick refresh.' : '[CacheManager] Performing regular state update.');

    try {
      // Fetch the latest status from the AC unit itself
      const status: AirConditionerStatus | null = await this.api.updateState(); 

      if (status) {
        // Update the internal DeviceState instance with the new status from the API
        const changed = this._deviceState.updateFromDevice(status);
        if (changed || !this.rawApiCache) { // also emit if it's the first load
          this.logger.debug('[CacheManager] Device state updated from API:', JSON.stringify(this._deviceState.toPlainObject()));
          this.emit('stateUpdated', this._deviceState); // Emit event that CacheManager's state has updated
        }
        this.rawApiCache = status; // Update raw cache as well
        this.lastFetch = Date.now();
        this.consecutiveFailedPolls = 0; // Reset failed polls on success
        if (this.isPollingDegraded) {
          this.logger.info('[CacheManager] Polling restored to normal interval.');
          this.ttl = this.originalTtl;
          this.isPollingDegraded = false;
        }
      } else {
        this.logger.warn('[CacheManager] Failed to get device status from API. State not updated.');
        this.consecutiveFailedPolls++;
        if (this.consecutiveFailedPolls >= this.maxConsecutiveFailedPolls && !this.isPollingDegraded) {
          this.logger.warn(`[CacheManager] Max consecutive failed polls (${this.consecutiveFailedPolls}) reached. Degrading polling interval.`);
          this.ttl = this.degradedTtl;
          this.isPollingDegraded = true;
        }
      }
    } catch (error) {
      this.logger.error('[CacheManager] Error updating device state:', error);
      this.consecutiveFailedPolls++;
      if (this.consecutiveFailedPolls >= this.maxConsecutiveFailedPolls && !this.isPollingDegraded) {
        this.logger.warn(`[CacheManager] Max consecutive failed polls (${this.consecutiveFailedPolls}) reached during error. Degrading polling interval.`);
        this.ttl = this.degradedTtl;
        this.isPollingDegraded = true;
      }
      // Optionally, emit an error event from CacheManager itself
      // this.emit('error', error);
    } finally {
      this.isUpdating = false;
      this.logger.debug(isQuickRefresh ? '[CacheManager] Quick refresh finished.' : '[CacheManager] Regular state update finished.');
      this.scheduleRefresh(); // Ensure polling continues
    }
    return this._deviceState;
  }

  /**
   * Apply changes from device state to the physical device.
   * This does not update the device state object itself, only sends commands.
   */
  async applyStateToDevice(desiredState: DeviceState): Promise<void> {
    this.logger.debug(`[CacheManager] Applying desired state: ${JSON.stringify(desiredState.toPlainObject())}`);
    // Ensure currentState (this._deviceState) is fresh before diffing.
    await this.updateDeviceState(true);
    const currentState = this._deviceState;
    this.logger.debug(`[CacheManager] Current actual state before diff: ${JSON.stringify(currentState.toPlainObject())}`);

    // Use PartialDeviceOptions directly as it's imported and matches setDeviceOptions parameter
    const options: PartialDeviceOptions = {};
    let changesMade = false;

    // Power state
    if (desiredState.power !== undefined && desiredState.power !== currentState.power) {
      options.power = desiredState.power;
      changesMade = true;
    }

    // Only consider other options if the desired power state is ON,
    // or if power is not being changed and the current state is ON.
    const considerSubOptions = desiredState.power === PowerState.On ||
                             (desiredState.power === undefined && currentState.power === PowerState.On);

    if (considerSubOptions) {
      if (desiredState.operationMode !== undefined && desiredState.operationMode !== currentState.operationMode) {
        options.mode = desiredState.operationMode;
        changesMade = true;
      }
      if (desiredState.targetTemperature !== undefined && desiredState.targetTemperature !== currentState.targetTemperature) {
        // Changed targetTemp to temp to match AirConditionerAPI.setOptionsCombined
        options.temp = desiredState.targetTemperature; 
        changesMade = true;
      }
      if (desiredState.fanSpeed !== undefined && desiredState.fanSpeed !== currentState.fanSpeed) {
        options.fanSpeed = desiredState.fanSpeed;
        changesMade = true;
      }
      if (desiredState.sleepMode !== undefined && desiredState.sleepMode !== currentState.sleepMode) {
        options.sleep = desiredState.sleepMode;
        changesMade = true;
      }
      if (desiredState.turboMode !== undefined && desiredState.turboMode !== currentState.turboMode) {
        options.turbo = desiredState.turboMode;
        changesMade = true;
      }
      if (desiredState.ecoMode !== undefined && desiredState.ecoMode !== currentState.ecoMode) {
        options.eco = desiredState.ecoMode;
        changesMade = true;
      }
      if (desiredState.displayMode !== undefined && desiredState.displayMode !== currentState.displayMode) {
        options.display = desiredState.displayMode;
        changesMade = true;
      }
      // Beep: If beepMode in desiredState is different, it's a request to change beep state.
      if (desiredState.beepMode !== undefined && desiredState.beepMode !== currentState.beepMode) {
        options.beep = desiredState.beepMode;
        changesMade = true;
      }
    } else if (options.power === PowerState.Off) {
      // If the only change is to turn power off, options will only contain { power: PowerState.Off }
      // All other parameters are implicitly turned off by the device.
      // No need to add other options if we are turning the device off.
      this.logger.debug('[CacheManager] Powering off. Other options will be ignored by setOptionsCombined or device.');
    }

    if (changesMade && Object.keys(options).length > 0) {
      this.logger.info(`[CacheManager] Changes detected. Enqueuing command with options: ${JSON.stringify(options)}`);
      const queue = this.getCommandQueue();
      
      // Changed from addCommand with CommandType to enqueueCommand with options directly
      await queue.enqueueCommand(options);

      // Optimistically update local DeviceState.
      // A method like `this._deviceState.updateFromOptions(options)` will be added to DeviceState.ts
      if (typeof this._deviceState.updateFromOptions === 'function') {
        this._deviceState.updateFromOptions(options);
        this.logger.debug(`[CacheManager] Optimistically updated local DeviceState to: ${JSON.stringify(this._deviceState.toPlainObject())} after enqueuing.`);
      } else {
        this.logger.warn('[CacheManager] DeviceState.updateFromOptions method not found. Skipping optimistic update.');
      }
    } else {
      this.logger.info('[CacheManager] No changes to apply.');
    }
  }

  /**
   * Clears the cached status, forcing a refresh on the next getStatus call.
   */
  clear(): void {
    this.rawApiCache = null; // Clear rawApiCache
    this.lastFetch = 0;
  }

  /**
   * Cleans up resources used by the underlying API instance.
   */
  cleanup(): void {
    if (this.quickRefreshTimer) {
      clearTimeout(this.quickRefreshTimer);
      this.quickRefreshTimer = null;
    }
    if (this.pollingTimer) { // Added
      clearTimeout(this.pollingTimer); // Added
      this.pollingTimer = null; // Added
    }

    if (this.api && typeof this.api.cleanup === 'function') {
      this.api.cleanup();
    }
    
    // Remove all listeners to prevent memory leaks
    if (this.api && typeof this.api.removeAllListeners === 'function') {
      this.api.removeAllListeners();
    }
    
    // Remove listeners from DeviceState to prevent memory leaks
    this._deviceState.removeAllListeners();

    // Add cleanup for commandQueue listeners
    if (this.commandQueue) {
      this.commandQueue.removeAllListeners();
    }
  }

  /**
   * Initialize the command queue if it doesn't exist.
   * This is separate from constructor to allow lazy initialization and proper logger setup.
   */
  private initCommandQueue(): CommandQueue {
    if (!this.commandQueue) {
      this.commandQueue = new CommandQueue(this.api, this._deviceState, this.logger);

      // Listener for successful command execution
      this.commandQueue.on('executed', (event: CommandExecutedEvent) => {
        this.logger.debug(`[CacheManager] Command executed: ${JSON.stringify(event.command)}. Scheduling quick refresh.`);
        this.scheduleQuickRefresh(); // This will lead to updateDeviceState(true), which then calls scheduleRefresh()
      });

      // Listener for command errors
      this.commandQueue.on('error', (event: CommandErrorEvent) => {
        this.logger.error(`[CacheManager] Command failed: ${JSON.stringify(event.command)}, Error: ${event.error.message}`);
        // Ensure regular polling resumes after a command error.
        this.logger.info('[CacheManager] Resuming regular polling due to command error.');
        this.scheduleRefresh();
      });
      
      this.commandQueue.on('maxRetriesReached', (event: CommandMaxRetriesReachedEvent) => {
        this.logger.error(`[CacheManager] Command failed after max retries: ${JSON.stringify(event.command)}, Error: ${event.error.message}`);
        // The 'error' event listener will handle scheduling the refresh.
        // This listener is for any specific actions for max retries if needed.
      });

    }
    
    return this.commandQueue;
  }

  private scheduleQuickRefresh(): void {
    if (this.quickRefreshTimer) {
      clearTimeout(this.quickRefreshTimer);
    }
    this.quickRefreshTimer = setTimeout(async () => {
      this.logger.debug('[CacheManager] Executing quick refresh after command.');
      try {
        await this.updateDeviceState(true); // isQuickRefresh = true
      } catch (error) {
        this.logger.error(`[CacheManager] Error during quick refresh: ${error instanceof Error ? error.message : String(error)}`);
      }
      // updateDeviceState calls scheduleRefresh in its finally block
    }, this.quickRefreshDelayMs);
    if (this.quickRefreshTimer && this.quickRefreshTimer.unref) { // Added .unref()
      this.quickRefreshTimer.unref();
    }
  }

  private scheduleRefresh(): void {
    if (this.pollingTimer) { // Changed to pollingTimer
      clearTimeout(this.pollingTimer); // Changed to pollingTimer
    }
    this.pollingTimer = setTimeout(async () => { // Changed to pollingTimer
      this.logger.debug(`[CacheManager] Executing regular scheduled refresh using TTL: ${this.ttl / 1000}s.`);
      try {
        await this.updateDeviceState(false); // isQuickRefresh = false
      } catch (error) {
        this.logger.error(`[CacheManager] Error during regular scheduled refresh: ${error instanceof Error ? error.message : String(error)}`);
      }
      // updateDeviceState itself calls scheduleRefresh in its finally block, creating the polling loop.
    }, this.ttl);
    if (this.pollingTimer && this.pollingTimer.unref) { // Added .unref() for pollingTimer
      this.pollingTimer.unref();
    }
  }

  /**
   * Get the command queue. Creates it if it doesn't exist.
   */
  public getCommandQueue(): CommandQueue {
    return this.initCommandQueue();
  }

  /**
   * Update the internal cache directly, used by tests.
   */
  public async updateCache(deviceId: string, newStatus: Partial<AirConditionerStatus>): Promise<void> {
    this.rawApiCache = newStatus as AirConditionerStatus;
    this._deviceState.updateFromDevice(this.rawApiCache);
  }
}

// Export the class directly instead of a default export
export { CacheManager as default };
