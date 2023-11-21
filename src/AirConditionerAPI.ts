// AirConditionerAPI.ts
import { EventEmitter } from 'events';
import * as dgram from 'dgram';
import * as xml2js from 'xml2js';

interface AirConditionerStatus {
  current_temp: number;
  target_temp: number;
  operation_mode: string;
  fan_mode: string;
  is_on: string;
  swing_mode: string;
}

export class AirConditionerAPI extends EventEmitter {
  private readonly ip: string;
  private readonly port: number;

  constructor(ip: string, port: number = 7777) {
    super();
    this.ip = ip;
    this.port = port;
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

  private sendCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const client = dgram.createSocket('udp4');
      client.send(command, this.port, this.ip, (error) => {
        if (error) {
          reject(error);
        }
      });
      client.on('message', (data) => {
        resolve(data.toString());
        client.close();
      });
    });
  }

  private mapWindDirectionToSwingMode(status: AirConditionerStatus): string {
    const value = (status.swing_mode === 'Both' ? 3 : (status.swing_mode === 'Vertical' ? 2 : (status.swing_mode === 'Horizontal' ? 1 : 0)))
    ;
    return { 0: 'Off', 1: 'Horizontal', 2: 'Vertical', 3: 'Both' }[value];
  }

  private createUpdateMessage(status: AirConditionerStatus): string {
    return `<TurnOn>${status.is_on}</TurnOn>` +
      `<BaseMode>${status.operation_mode}</BaseMode>` +
      `<SetTemp>${status.target_temp}</SetTemp>` +
      `<WindSpeed>${status.fan_mode}</WindSpeed>`;
  }

  async getOnState(): Promise<boolean> {
    try {
      // Command to get the actual state of the air conditioner
      const command = '<msg msgid="SyncStatusReq" type="Control" seq="12345"><SyncStatusReq></SyncStatusReq></msg>';
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const response = await this.sendCommand(command);
      // Assume the state is always on for now; you should update this with the actual logic
      return true;
    } catch (error) {
      // Log the error and return false (assuming the state is off if there's an error)
      console.error('Error getting actual state:', error);
      return false;
    }
  }

  async updateState(): Promise<AirConditionerStatus> {
    const command = `<msg msgid="SyncStatusReq" type="Control" seq="${Date.now()}"><SyncStatusReq></SyncStatusReq></msg>`;
    const response = await this.sendCommand(command);
    const xmlObject = await xml2js.parseStringPromise(response);
    const statusUpdateMsg = xmlObject['msg']['statusUpdateMsg'];
    const status: AirConditionerStatus = {
      current_temp: parseFloat(statusUpdateMsg['IndoorTemp'][0]),
      target_temp: parseFloat(statusUpdateMsg['SetTemp'][0]),
      operation_mode: statusUpdateMsg['BaseMode'][0],
      fan_mode: statusUpdateMsg['WindSpeed'][0],
      is_on: statusUpdateMsg['TurnOn'][0],
      swing_mode: this.mapWindDirectionToSwingMode(statusUpdateMsg),
    };
    return status;
  }

  async setAirConditionerState(mode: string, value: string): Promise<void> {
    const status = await this.updateState();
    status[mode] = value;
    if (mode === 'operation_mode') {
      status['is_on'] = 'on';
    }
    const updateMessage = this.createUpdateMessage(status);
    const command = `<msg msgid="SetMessage" type="Control" seq="${Date.now()}"><SetMessage>${updateMessage}</SetMessage></msg>`;
    await this.sendCommand(command);
  }

  async setSwingMode(value: string): Promise<void> {
    const command = `<msg msgid="SetMessage" type="Control" seq="${Date.now()}">${SET_SWING[value]}</msg>`;
    await this.sendCommand(command);
  }
}

const SET_SWING = {
  'Off': '<WindDirection_H>off</WindDirection_H><WindDirection_V>off</WindDirection_V>',
  'Vertical': '<WindDirection_H>off</WindDirection_H><WindDirection_V>on</WindDirection_V>',
  'Horizontal': '<WindDirection_H>on</WindDirection_H><WindDirection_V>off</WindDirection_V>',
  'Both': '<WindDirection_H>on</WindDirection_H><WindDirection_V>on</WindDirection_V>',
};

export default AirConditionerAPI;  // Export the class as the default export