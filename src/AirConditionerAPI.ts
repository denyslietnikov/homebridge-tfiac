// AirConditionerAPI.ts
import { EventEmitter } from 'events';

export class AirConditionerAPI extends EventEmitter {
  private readonly ip: string;

  constructor(ip: string) {
    super();
    this.ip = ip;
  }

  // TODO: Add basic methods for controlling the air conditioner
}

export default AirConditionerAPI;
