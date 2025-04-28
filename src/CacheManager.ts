import AirConditionerAPI, { AirConditionerStatus } from './AirConditionerAPI.js';
import { TfiacDeviceConfig } from './settings.js';

export class CacheManager {
  private static instances = new Map<string, CacheManager>();
  private api: AirConditionerAPI;
  private cache: AirConditionerStatus | null = null;
  private lastFetch = 0;
  private ttl: number;

  private constructor(private config: TfiacDeviceConfig) {
    this.api = new AirConditionerAPI(config.ip, config.port);
    this.ttl = (config.updateInterval || 30) * 1000;
  }

  static getInstance(config: TfiacDeviceConfig): CacheManager {
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

  clear(): void {
    this.cache = null;
  }
}

// Export the class directly instead of a default export
export { CacheManager as default };
