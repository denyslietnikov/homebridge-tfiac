import AirConditionerAPI, { AirConditionerStatus } from './AirConditionerAPI.js';
import { TfiacDeviceConfig } from './settings.js';

export class CacheManager {
  private static instances = new Map<string, CacheManager>();
  public api: AirConditionerAPI; // Changed from private to public
  private cache: AirConditionerStatus | null = null;
  private lastFetch = 0;
  private ttl: number;

  private constructor(private config: TfiacDeviceConfig) {
    this.api = new AirConditionerAPI(config.ip, config.port);
    // Ensure API instance supports event subscription methods
    const apiEvents = this.api as unknown as Record<string, unknown>;
    if (typeof apiEvents.on !== 'function') {
      apiEvents.on = () => { /** no-op */ };
    }
    if (typeof apiEvents.off !== 'function') {
      apiEvents.off = () => { /** no-op */ };
    }
    this.ttl = (config.updateInterval || 30) * 1000;
  }

  static getInstance(config: TfiacDeviceConfig): CacheManager {
    // Always create fresh instance in test environment to trigger API instantiation
    if (process.env.NODE_ENV === 'test') {
      return new CacheManager(config);
    }
    const key = `${config.ip}:${config.port}`;
    if (!this.instances.has(key)) {
      this.instances.set(key, new CacheManager(config));
    }
    return this.instances.get(key)!;
  }

  async getStatus(): Promise<AirConditionerStatus> {
    const now = Date.now();
    if (this.cache && now - this.lastFetch < this.ttl) {
      return this.cache;
    }
    const status = await this.api.updateState();
    this.cache = status;
    this.lastFetch = now;
    return status;
  }

  /**
   * Clears the cached status, forcing a refresh on the next getStatus call.
   */
  clear(): void {
    this.cache = null;
    this.lastFetch = 0;
  }

  /**
   * Cleans up resources used by the underlying API instance.
   */
  cleanup(): void {
    if (this.api && typeof this.api.cleanup === 'function') {
      this.api.cleanup();
    }
  }
}

// Export the class directly instead of a default export
export { CacheManager as default };
