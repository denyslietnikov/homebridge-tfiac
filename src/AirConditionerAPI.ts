// AirConditionerAPI.ts
import { EventEmitter } from 'events';
import * as dgram from 'dgram';

export class AirConditionerAPI extends EventEmitter {
  private readonly ip: string;
  private readonly port: number;

  constructor(ip: string, port: number = 7777) {
    super();
    this.ip = ip;
    this.port = port;
  }

  private sendCommand(command: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const client = dgram.createSocket('udp4');
      client.send(command, this.port, this.ip, (error) => {
        client.close();
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  async getOnState(): Promise<boolean> {
    // Command to get the actual state of the air conditioner
    const command = '<msg msgid="SyncStatusReq" type="Control" seq="12345"><SyncStatusReq></SyncStatusReq></msg>';

    try {
      // Send the command to get the actual state
      await this.sendCommand(command);
      // Assume the state is always on for now; you should update this with the actual logic
      return true;
    } catch (error) {
      // Log the error and return false (assuming the state is off if there's an error)
      console.error('Error getting actual state:', error);
      return false;
    }
  }

  async turnOn(): Promise<void> {
    // Command to turn on the air conditioner
    const command = '<msg msgid="SetMessage" type="Control" seq="1"><SetMessage><TurnOn>on</TurnOn></SetMessage></msg>';
    await this.sendCommand(command);
  }

  async turnOff(): Promise<void> {
    // Command to turn off the air conditioner
    const command = '<msg msgid="SetMessage" type="Control" seq="12345"><SetMessage><TurnOn>off</TurnOn></SetMessage></msg>';
    await this.sendCommand(command);
  }
}

export default AirConditionerAPI;
