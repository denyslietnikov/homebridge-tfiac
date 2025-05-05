// AirConditionerAPI.ts

import { EventEmitter } from 'events';
import * as dgram from 'dgram';
import * as xml2js from 'xml2js';
import { PowerState, OperationMode, FanSpeed, SwingMode, SleepModeState } from './enums.js';

export interface AirConditionerStatus {
  is_on: PowerState | string; // Allow string for test compatibility
  operation_mode: OperationMode | string; // Allow string for potential unknown modes
  target_temp: number;
  current_temp: number;
  fan_mode: FanSpeed | string; // Allow string for potential unknown modes
  swing_mode: SwingMode | string; // Allow string for potential unknown modes
  opt_turbo?: PowerState;
  opt_eco?: PowerState;
  opt_display?: PowerState;
  opt_beep?: PowerState;
  opt_sleepMode?: SleepModeState | string; // Allow string for potential unknown modes
  outdoor_temp?: number;
}

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
  OutdoorTemp?: string[]; // Optional outdoor temperature
}

// Throttle intervals in milliseconds
const SHORT_WAIT = 500;
const LONG_WAIT = 3000;

export class AirConditionerAPI extends EventEmitter {
  private readonly ip: string;
  private readonly port: number;
  public available: boolean;
  private lastSeq: number;
  private activeTimeouts: NodeJS.Timeout[] = [];
  private maxRetries: number = 3; // Maximum number of retries for a command
  private retryDelay: number = 1000; // Delay between retries in milliseconds

  // Last time updateState actually sent a request
  private lastSyncTime: number = 0;
  // Cached last-status for throttling
  private lastStatus: AirConditionerStatus | null = null;

  constructor(ip: string, port: number = 7777, maxRetries: number = 3, retryDelay: number = 1000) {
    super();
    this.ip = ip;
    this.port = port;
    this.available = true;
    this.lastSeq = 0;
    this.maxRetries = maxRetries;
    this.retryDelay = retryDelay;
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
    // Return a sequence number that increments on each call to ensure uniqueness
    this.lastSeq = (this.lastSeq + 1) % 100000000;
    return this.lastSeq.toString();
  }

  private async sendCommandWithRetry(command: string, timeoutMs: number = 10000, retryCount: number = 0): Promise<string> {
    try {
      return await this.sendCommand(command, timeoutMs);
    } catch (error) {
      // If we've reached max retries, rethrow the error
      if (retryCount >= this.maxRetries) {
        this.emit('debug', `Max retries (${this.maxRetries}) reached for command, giving up.`);
        throw error;
      }

      // If it's a timeout error, retry
      if (error instanceof Error && error.message === 'Command timed out') {
        const nextRetry = retryCount + 1;
        this.emit('debug', `Command timed out, retry attempt ${nextRetry}/${this.maxRetries}`);
        
        // Wait before retrying without blocking the event loop
        await new Promise(resolve => {
          const t = setTimeout(resolve, this.retryDelay);
          if (t.unref) {
            t.unref();
          }
        });
        
        // Try again with incremented retry count
        return this.sendCommandWithRetry(command, timeoutMs, nextRetry);
      }

      // For other errors, just rethrow
      throw error;
    }
  }

  private async sendCommand(command: string, timeoutMs: number = 10000): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      interface DgramSocket {
        unref?: () => void;
        on(event: string, cb: (...args: unknown[]) => void): void;
        removeAllListeners(): void;
        close(): void;
        send(
          msg: string | Buffer,
          port: number,
          ip: string,
          cb: (error: Error | null | undefined) => void
        ): void;
      }
      interface DgramModule {
        default?: { createSocket: (type: string) => DgramSocket };
        createSocket?: (type: string) => DgramSocket;
      }
      // Use the DgramModule type to access createSocket
      const dmModule = dgram as unknown as DgramModule;
      let createSocketFn: ((type: string) => DgramSocket) | undefined;
      // Prefer explicit namespace export (e.g., when tests assign dgram.createSocket)
      if ('createSocket' in dmModule && typeof dmModule.createSocket === 'function') {
        createSocketFn = dmModule.createSocket.bind(dmModule);
      } else if (dmModule.default && typeof dmModule.default.createSocket === 'function') {
        createSocketFn = dmModule.default.createSocket.bind(dmModule.default);
      }
      if (!createSocketFn) {
        throw new Error('dgram.createSocket is not a function');
      }

      const client = createSocketFn('udp4');

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
      // Prevent timer from keeping the process alive (if supported)
      if (timeoutId && typeof timeoutId.unref === 'function') {
        timeoutId.unref();
      }
      this.activeTimeouts.push(timeoutId);

      client.on('message', (data) => {
        if (!isResolved) {
          isResolved = true;
          this.available = true;
          cleanupSocket();
          const response = (data as Buffer).toString();
          // Graceful fallback for UnknownCmd
          if (response.includes('<UnknownCmd>')) {
            // Log warning and resolve as no-op
            console.warn('[TFIAC] Device responded with <UnknownCmd>. Command ignored.');
            resolve(response);
            return;
          }
          resolve(response);
        }
      });
      client.on('error', (err) => {
        if (!isResolved) {
          isResolved = true;
          this.available = false;
          cleanupSocket();
          reject(err as Error);
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
    await this.setAirConditionerState('is_on', PowerState.On);
  }

  async turnOff(): Promise<void> {
    // Turn off and reset Sleep Mode in a single command to avoid double beep
    const command = `<msg msgid="SetMessage" type="Control" seq="${this.seq}">
      <SetMessage><TurnOn>off</TurnOn><Opt_sleepMode>off</Opt_sleepMode></SetMessage>
    </msg>`;
    await this.sendCommandWithRetry(command);
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

  async updateState(force: boolean = false): Promise<AirConditionerStatus> {
    const now = Date.now();
    if (!force && this.lastSyncTime > 0) {
      const wait = this.lastSeq === 0 ? SHORT_WAIT : LONG_WAIT;
      if (now - this.lastSyncTime < wait && this.lastStatus) {
        this.emit('debug', `Throttling updateState: returning cached status. Elapsed ${now - this.lastSyncTime}ms < ${wait}ms`);
        return this.lastStatus;
      }
    }
    const command = `<msg msgid="SyncStatusReq" type="Control" seq="${this.seq}">
                      <SyncStatusReq></SyncStatusReq></msg>`;
    this.emit('debug', `Sending updateState command: ${command}`);
    const response = await this.sendCommandWithRetry(command);
    this.emit('debug', `Received response: ${response}`);
    try {
      const xmlObject = await xml2js.parseStringPromise(response);
      const statusUpdateMsg = xmlObject.msg.statusUpdateMsg[0] as StatusUpdateMsg;
      const status: AirConditionerStatus = {
        current_temp: parseFloat(statusUpdateMsg.IndoorTemp[0]),
        target_temp: parseFloat(statusUpdateMsg.SetTemp[0]),
        operation_mode: statusUpdateMsg.BaseMode[0] as OperationMode, // Assume API sends valid OperationMode strings
        fan_mode: statusUpdateMsg.WindSpeed[0] as FanSpeed, // Assume API sends valid FanSpeed strings
        is_on: statusUpdateMsg.TurnOn[0] as PowerState, // Cast string 'on'/'off' to PowerState
        swing_mode: this.mapWindDirectionToSwingMode(statusUpdateMsg) as SwingMode, // mapWindDirection returns string matching SwingMode
        opt_display: statusUpdateMsg.Opt_display ? statusUpdateMsg.Opt_display[0] as PowerState : undefined, // Cast 'on'/'off'
        opt_turbo: statusUpdateMsg.Opt_super ? statusUpdateMsg.Opt_super[0] as PowerState : undefined, // Cast 'on'/'off', assuming Opt_super maps to opt_turbo
        opt_sleepMode: statusUpdateMsg.Opt_sleepMode ? statusUpdateMsg.Opt_sleepMode[0] : undefined, // Keep as string | undefined for now
        outdoor_temp: statusUpdateMsg.OutdoorTemp && statusUpdateMsg.OutdoorTemp[0] !== undefined ? parseFloat(statusUpdateMsg.OutdoorTemp[0]) : undefined,
        // opt_eco and opt_beep might need similar handling if present in statusUpdateMsg
      };
      this.emit('debug', `Parsed status: ${JSON.stringify(status)}`);
      this.lastSyncTime = Date.now();
      this.lastStatus = status;
      return status;
    } catch (error) {
      this.emit('error', `Error parsing response: ${error}`);
      throw error;
    }
  }

  async setAirConditionerState(
    parameter: keyof AirConditionerStatus, 
    value: string | number | PowerState | OperationMode | FanSpeed | SwingMode | SleepModeState,
  ): Promise<void> {
    const status = await this.updateState();

    // Use type guards or explicit checks for each parameter type
    if (parameter === 'current_temp' || parameter === 'target_temp') {
      // These are numbers
      status[parameter] = parseFloat(value as string);
    } else if (parameter === 'is_on' || parameter === 'opt_turbo' || parameter === 'opt_eco' || parameter === 'opt_display' || parameter === 'opt_beep') {
      // These are PowerState
      status[parameter] = value as PowerState;
    } else if (parameter === 'operation_mode') {
      // This is OperationMode | string
      status[parameter] = value as OperationMode | string;
      // Also turn on the device when changing mode
      status.is_on = PowerState.On;
    } else if (parameter === 'fan_mode') {
      // This is FanSpeed | string
      status[parameter] = value as FanSpeed | string;
    } else if (parameter === 'swing_mode') {
      // This is SwingMode | string
      status[parameter] = value as SwingMode | string;
    } else if (parameter === 'opt_sleepMode') {
      // This is SleepModeState | string
      status[parameter] = value as SleepModeState | string;
    } else if (parameter === 'outdoor_temp') {
      // This is number | undefined, likely read-only from HomeKit perspective
      this.emit('warn', `Attempted to set read-only parameter: ${parameter}`);
      return; // Do not attempt to set read-only values
    }
    // No 'else' block needed, covering all mutable properties explicitly avoids the 'never' type issue.

    const updateMessage = this.createUpdateMessage(status);
    // Disable max-len for this specific line as formatting attempts failed
     
    const command = `<msg msgid="SetMessage" type="Control" seq="${this.seq}">\n  <SetMessage>${updateMessage}</SetMessage>\n</msg>`;
    await this.sendCommandWithRetry(command);
  }

  async setSwingMode(mode: SwingMode | string): Promise<void> {
    const SET_SWING: Record<'Off' | 'Vertical' | 'Horizontal' | 'Both', string> = {
      Off: '<WindDirection_H>off</WindDirection_H><WindDirection_V>off</WindDirection_V>',
      Vertical: '<WindDirection_H>off</WindDirection_H><WindDirection_V>on</WindDirection_V>',
      Horizontal: '<WindDirection_H>on</WindDirection_H><WindDirection_V>off</WindDirection_V>',
      Both: '<WindDirection_H>on</WindDirection_H><WindDirection_V>on</WindDirection_V>',
    };
    const command = `<msg msgid="SetMessage" type="Control" seq="${this.seq}"><SetMessage>${SET_SWING[mode as keyof typeof SET_SWING]}</SetMessage></msg>`;
    await this.sendCommandWithRetry(command);
  }

  async setFanSpeed(speed: FanSpeed | string): Promise<void> {
    await this.setAirConditionerState('fan_mode', speed);
  }

  /**
   * Generic method to set option state for the air conditioner
   */
  private async setOptionState(option: string, value: string, callerMethod?: string): Promise<void> {
    // Emit debug event so BaseSwitchAccessory can log when commands are sent
    // Include caller method name if provided to improve debugging context
    const methodPrefix = callerMethod ? `[${callerMethod}] ` : '';
    this.emit('debug', `${methodPrefix}setOptionState: <${option}>${value}</${option}>`);
    const command = `<msg msgid="SetMessage" type="Control" seq="${this.seq}">
                      <SetMessage><${option}>${value}</${option}></SetMessage></msg>`;
    await this.sendCommandWithRetry(command);
  }

  /**
   * Set the display state (on/off) for the air conditioner.
   */
  async setDisplayState(state: PowerState): Promise<void> {
    // The display on/off flag corresponds to the `<Opt_display>` element
    // in the device’s XML protocol, so we need to send it explicitly
    // using the generic option setter instead of the high‑level
    // `setAirConditionerState` helper (which doesn’t include this flag
    // in the aggregated message).
    await this.setOptionState('Opt_display', state, 'setDisplayState');
  }

  /**
   * Set the Turbo state (on/off) for the air conditioner.
   * Uses the generic <Opt_super> tag in the device's XML protocol.
   */
  async setTurboState(state: PowerState): Promise<void> {
    await this.setOptionState('Opt_super', state);
  }

  /**
   * Set the Sleep state (on/off) for the air conditioner.
   * Uses the generic <Opt_sleepMode> tag in the device's XML protocol.
   * For 'on', sends the detailed sleep string; for 'off', sends 'off'.
   */
  async setSleepState(state: SleepModeState | string): Promise<void> {
    const isOn = 
      (typeof state === 'string' && state.toLowerCase() !== 'off') ||
      state === SleepModeState.On;

    const sleepValue = isOn
      ? 'sleepMode1:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0'
      : 'off';

    await this.setOptionState('Opt_sleepMode', sleepValue);
  }

  /**
   * Set the Eco state (on/off) for the air conditioner.
   * Uses the generic <Opt_eco> tag in the device's XML protocol.
   */
  async setEcoState(state: PowerState): Promise<void> {
    await this.setOptionState('Opt_eco', state, 'setEcoState');
  }

  /**
   * Set the Beep (Opt_beep) state (on/off) for the air conditioner.
   */
  async setBeepState(state: PowerState): Promise<void> {
    await this.setOptionState('Opt_beep', state, 'setBeepState');
  }
}

// Export the class directly instead of a default export
export default AirConditionerAPI;