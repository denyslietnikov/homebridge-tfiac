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
  opt_display?: string; // Display state (on/off), optional
  opt_super?: string; // Turbo state (on/off), optional
  opt_sleepMode?: string; // Sleep mode state (string, e.g. 'sleepMode1:0:0:0:...'), optional
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
  Opt_display?: string[]; // Optional display state
  Opt_super?: string[]; // Optional turbo state
  Opt_sleepMode?: string[]; // Optional sleep mode state
}

type AirConditionerMode = keyof AirConditionerStatusInternal;

export class AirConditionerAPI extends EventEmitter {
  private readonly ip: string;
  private readonly port: number;
  public available: boolean;
  private lastSeq: number;
  private activeTimeouts: NodeJS.Timeout[] = [];

  constructor(ip: string, port: number = 7777) {
    super();
    this.ip = ip;
    this.port = port;
    this.available = true;
    this.lastSeq = 0;
  }

  /**
   * Cleanup resources (useful for tests)
   */
  public cleanup(): void {
    // Clear all active timers
    this.activeTimeouts.forEach(timeoutId => {
      clearTimeout(timeoutId);
    });
    this.activeTimeouts = [];
  }

  private get seq(): string {
    // Return a sequence number (in this case we can use timestamp)
    return (Date.now() % 10000000).toString();
  }

  private async sendCommand(command: string, timeoutMs: number = 5000): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      // Create socket
      const client = dgram.createSocket('udp4');

      // Call unref if available
      if (typeof client.unref === 'function') {
        client.unref(); 
      }

      let isResolved = false;
      // eslint-disable-next-line prefer-const
      let timeoutId: NodeJS.Timeout;

      // Function to cleanup socket and timeout
      const cleanupSocket = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          const index = this.activeTimeouts.indexOf(timeoutId);
          if (index !== -1) {
            this.activeTimeouts.splice(index, 1);
          }
        }
        if (client && typeof client.removeAllListeners === 'function') {
          client.removeAllListeners();
        }
        if (client && typeof client.close === 'function') {
          try {
            client.close();
          } catch (err) {
            // ignore errors during close
          }
        }
      };

      timeoutId = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          this.available = false;
          cleanupSocket();
          reject(new Error('Command timed out'));
        }
      }, timeoutMs);
      this.activeTimeouts.push(timeoutId);

      client.on('message', (data) => {
        if (!isResolved) {
          isResolved = true;
          this.available = true;
          cleanupSocket();
          resolve(data.toString());
        }
      });

      client.on('error', (error) => {
        if (!isResolved) {
          isResolved = true;
          this.available = false;
          cleanupSocket();
          reject(error);
        }
      });

      // Send command
      client.send(command, this.port, this.ip, (error) => {
        if (error && !isResolved) {
          isResolved = true;
          this.available = false;
          cleanupSocket();
          reject(error);
        }
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
      opt_display: statusUpdateMsg.Opt_display ? statusUpdateMsg.Opt_display[0] : undefined,
      opt_super: statusUpdateMsg.Opt_super ? statusUpdateMsg.Opt_super[0] : undefined,
      opt_sleepMode: statusUpdateMsg.Opt_sleepMode ? statusUpdateMsg.Opt_sleepMode[0] : undefined,
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

  /**
   * Set the display state (on/off) for the air conditioner.
   */
  async setDisplayState(value: 'on' | 'off'): Promise<void> {
    const command = `<msg msgid="SetMessage" type="Control" seq="${this.seq}">
                      <SetMessage><Opt_display>${value}</Opt_display></SetMessage></msg>`;
    await this.sendCommand(command);
  }

  /**
   * Set the Turbo (Opt_super) state (on/off) for the air conditioner.
   */
  async setTurboState(value: 'on' | 'off'): Promise<void> {
    const command = `<msg msgid="SetMessage" type="Control" seq="${this.seq}">
                      <SetMessage><Opt_super>${value}</Opt_super></SetMessage></msg>`;
    await this.sendCommand(command);
  }

  /**
   * Set the Sleep (Opt_sleepMode) state (on/off) for the air conditioner.
   * For 'on', sends 'sleepMode1:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0', for 'off' sends 'off'.
   */
  async setSleepState(value: 'on' | 'off'): Promise<void> {
    const sleepValue = value === 'on'
      ? 'sleepMode1:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0'
      : 'off';
    const command = `<msg msgid="SetMessage" type="Control" seq="${this.seq}">
                      <SetMessage><Opt_sleepMode>${sleepValue}</Opt_sleepMode></SetMessage></msg>`;
    await this.sendCommand(command);
  }
}

export default AirConditionerAPI;