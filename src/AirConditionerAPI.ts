// AirConditionerAPI.ts

import { EventEmitter } from 'events';
import * as dgram from 'dgram';
import * as xml2js from 'xml2js';

interface AirConditionerStatusInternal {
  current_temp: number;
  target_temp: number;
  operation_mode: string;
  fan_mode: string;
  is_on: string;
  swing_mode: string;
}

export type AirConditionerStatus = AirConditionerStatusInternal;

interface StatusUpdateMsg {
  IndoorTemp: string[];
  SetTemp: string[];
  BaseMode: string[];
  WindSpeed: string[];
  TurnOn: string[];
  WindDirection_H: string[];
  WindDirection_V: string[];
}

type AirConditionerMode = keyof AirConditionerStatusInternal;

export class AirConditionerAPI extends EventEmitter {
  private readonly ip: string;
  private readonly port: number;
  private available: boolean;
  private lastSeq: number;

  constructor(ip: string, port: number = 7777) {
    super();
    this.ip = ip;
    this.port = port;
    this.available = true;
    this.lastSeq = 0;
  }

  private get seq(): string {
    return (Date.now() % 10000000).toString();
  }

  private async sendCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const client = dgram.createSocket('udp4');
      client.send(command, this.port, this.ip, (error) => {
        if (error) {
          this.available = false;
          reject(error);
        }
      });

      client.on('message', (data) => {
        this.available = true;
        resolve(data.toString());
        client.close();
      });

      client.on('error', (error) => {
        this.available = false;
        reject(error);
      });
    });
  }

  async turnOn(): Promise<void> {
    const command = `<msg msgid="SetMessage" type="Control" seq="${this.seq}">
                      <SetMessage><TurnOn>on</TurnOn></SetMessage></msg>`;
    await this.sendCommand(command);
  }

  async turnOff(): Promise<void> {
    const command = `<msg msgid="SetMessage" type="Control" seq="${this.seq}">
                      <SetMessage><TurnOn>off</TurnOn></SetMessage></msg>`;
    await this.sendCommand(command);
  }

  private mapWindDirectionToSwingMode(status: StatusUpdateMsg): string {
    const value =
      (status.WindDirection_H[0] === 'on' ? 1 : 0) |
      (status.WindDirection_V[0] === 'on' ? 2 : 0);
    return { 0: 'Off', 1: 'Horizontal', 2: 'Vertical', 3: 'Both' }[value] || 'Off';
  }

  private createUpdateMessage(status: AirConditionerStatus): string {
    return `<TurnOn>${status.is_on}</TurnOn>` +
           `<BaseMode>${status.operation_mode}</BaseMode>` +
           `<SetTemp>${status.target_temp}</SetTemp>` +
           `<WindSpeed>${status.fan_mode}</WindSpeed>`;
  }

  async updateState(): Promise<AirConditionerStatus> {
    const command = `<msg msgid="SyncStatusReq" type="Control" seq="${this.seq}">
                      <SyncStatusReq></SyncStatusReq></msg>`;
    const response = await this.sendCommand(command);
    const xmlObject = await xml2js.parseStringPromise(response);
    const statusUpdateMsg = xmlObject.msg.statusUpdateMsg[0] as StatusUpdateMsg;
    const status: AirConditionerStatus = {
      current_temp: parseFloat(statusUpdateMsg.IndoorTemp[0]),
      target_temp: parseFloat(statusUpdateMsg.SetTemp[0]),
      operation_mode: statusUpdateMsg.BaseMode[0],
      fan_mode: statusUpdateMsg.WindSpeed[0],
      is_on: statusUpdateMsg.TurnOn[0],
      swing_mode: this.mapWindDirectionToSwingMode(statusUpdateMsg),
    };
    return status;
  }

  async setAirConditionerState(mode: AirConditionerMode, value: string): Promise<void> {
    const status = await this.updateState();
    if (mode === 'current_temp' || mode === 'target_temp') {
      (status[mode] as number) = parseFloat(value);
    } else {
      (status[mode] as string) = value;
    }
    if (mode === 'operation_mode') {
      status.is_on = 'on';
    }
    const updateMessage = this.createUpdateMessage(status);
    const command = `<msg msgid="SetMessage" type="Control" seq="${this.seq}">
                      <SetMessage>${updateMessage}</SetMessage></msg>`;
    await this.sendCommand(command);
  }

  async setSwingMode(value: string): Promise<void> {
    const SET_SWING: Record<'Off' | 'Vertical' | 'Horizontal' | 'Both', string> = {
      Off: '<WindDirection_H>off</WindDirection_H><WindDirection_V>off</WindDirection_V>',
      Vertical: '<WindDirection_H>off</WindDirection_H><WindDirection_V>on</WindDirection_V>',
      Horizontal: '<WindDirection_H>on</WindDirection_H><WindDirection_V>off</WindDirection_V>',
      Both: '<WindDirection_H>on</WindDirection_H><WindDirection_V>on</WindDirection_V>',
    };
    const command = `<msg msgid="SetMessage" type="Control" seq="${this.seq}">
                      <SetMessage>${SET_SWING[value as keyof typeof SET_SWING]}</SetMessage></msg>`;
    await this.sendCommand(command);
  }

  async setFanSpeed(value: string): Promise<void> {
    const command = `<msg msgid="SetMessage" type="Control" seq="${this.seq}">
                      <SetMessage><WindSpeed>${value}</WindSpeed></SetMessage></msg>`;
    await this.sendCommand(command);
  }
}

export default AirConditionerAPI;