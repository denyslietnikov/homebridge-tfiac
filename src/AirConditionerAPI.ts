// AirConditionerAPI.ts

import { EventEmitter } from 'events';
import * as dgram from 'dgram';
import * as xml2js from 'xml2js';
import { PowerState, OperationMode, FanSpeed, SwingMode, SleepModeState, FanSpeedPercentMap } from './enums.js';

export interface AirConditionerStatus {
  is_on: PowerState | string; // Allow string for test compatibility
  operation_mode: OperationMode | string; // Allow string for potential unknown modes
  target_temp: number;
  current_temp: number;
  fan_mode: FanSpeed | string; // Allow string for potential unknown modes
  swing_mode: SwingMode | string; // Allow string for potential unknown modes
  opt_turbo?: PowerState; // Internal representation of Opt_super from protocol (Turbo mode)
  opt_eco?: PowerState;
  opt_display?: PowerState;
  opt_beep?: PowerState;
  opt_sleep?: PowerState; // Additional sleep state property
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
  Opt_super?: string[]; // Turbo mode in protocol, maps to opt_turbo in our status
  Opt_sleepMode?: string[]; // Optional sleep mode state
  OutdoorTemp?: string[]; // Optional outdoor temperature
}

// Define DeviceOptions and PartialDeviceOptions based on setOptionsCombined parameters
export interface DeviceOptions {
  id: string; // Added id
  name: string; // Added name
  power: PowerState;
  mode: OperationMode;
  temp: number;
  fanSpeed: FanSpeed;
  swingMode: SwingMode; // Changed from SwingMode | string
  sleep: SleepModeState | string;
  turbo: PowerState;
  display: PowerState;
  eco: PowerState;
  beep: PowerState;
}

export type PartialDeviceOptions = Partial<DeviceOptions>;

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
    this.activeTimeouts.forEach((timeoutId) => {
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
        await new Promise((resolve) => {
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
          cb: (error: Error | null | undefined) => void,
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

  private async _sendCommandPayload(
    payloadItems: Record<string, string | number | undefined>,
    optimisticUpdate: Partial<AirConditionerStatus>,
    callerMethod?: string,
  ): Promise<void> {
    let messageBody = '';
    for (const key in payloadItems) {
      if (payloadItems[key] !== undefined) {
        messageBody += `<${key}>${payloadItems[key]}</${key}>`;
      }
    }

    if (!messageBody) {
      this.emit('debug', `${callerMethod ? `[${callerMethod}] ` : ''}No changes to send.`);
      // Even if no changes to send, if there's an optimistic update, apply it and emit.
      // This can happen if all requested states match current states after conflict resolution.
      if (this.lastStatus && Object.keys(optimisticUpdate).length > 0) {
        Object.assign(this.lastStatus, optimisticUpdate);
        this.emit('status', this.lastStatus);
      }
      return;
    }

    const command = `<msg msgid="SetMessage" type="Control" seq="${this.seq}">
                      <SetMessage>${messageBody}</SetMessage></msg>`;

    this.emit('debug', `${callerMethod ? `[${callerMethod}] ` : ''}Sending command: ${command}`);
    const response = await this.sendCommandWithRetry(command);
    this.emit('debug', `${callerMethod ? `[${callerMethod}] ` : ''}Received response: ${response}`);

    if (this.lastStatus) {
      Object.assign(this.lastStatus, optimisticUpdate);
      this.emit('status', this.lastStatus);
    } else if (Object.keys(optimisticUpdate).length > 0) {
      // If lastStatus was null, initialize it with optimisticUpdate
      // This might be partial, updateState should be called soon after.
      this.lastStatus = optimisticUpdate as AirConditionerStatus;
      this.emit('status', this.lastStatus);
    }
  }

  public async setDeviceOptions(options: PartialDeviceOptions): Promise<void> {
    if (!this.lastStatus) {
      await this.updateState(); // Ensure lastStatus is initialized
    }
    // Deep clone lastStatus to avoid modifying the cache directly before command execution
    const current = this.lastStatus ? JSON.parse(JSON.stringify(this.lastStatus)) : ({} as AirConditionerStatus);

    // Determine effective states, starting with current, then applying options
    let effPower = options.power !== undefined ? options.power : (current.is_on || PowerState.Off);

    // If any other option is set that implies the AC should be active, and power is not explicitly set to Off
    if (effPower === PowerState.Off && options.power === undefined) {
      if (options.mode !== undefined ||
          options.temp !== undefined ||
          options.fanSpeed !== undefined ||
          options.swingMode !== undefined ||
          options.turbo === PowerState.On ||
          (options.sleep && options.sleep !== SleepModeState.Off && options.sleep !== 'off') || // Check for active sleep string value too
          options.display === PowerState.On ||
          options.eco === PowerState.On
      ) {
        effPower = PowerState.On;
      }
    }

    const effMode = options.mode !== undefined ? options.mode : current.operation_mode || OperationMode.Auto;
    const effTemp = options.temp !== undefined ? options.temp : current.target_temp || 24;
    let effFan = options.fanSpeed !== undefined ? options.fanSpeed : current.fan_mode || FanSpeed.Auto;
    let effSleep = options.sleep !== undefined ? options.sleep : current.opt_sleepMode || SleepModeState.Off;
    let effTurbo = options.turbo !== undefined ? options.turbo : current.opt_turbo || PowerState.Off;
    const effSwing = options.swingMode !== undefined ? options.swingMode : current.swing_mode || SwingMode.Off;

    const effDisplay = options.display !== undefined ? options.display : current.opt_display;
    const effEco = options.eco !== undefined ? options.eco : current.opt_eco;
    const effBeep = options.beep !== undefined ? options.beep : current.opt_beep;

    // Conflict resolution & derived states
    if (effPower === PowerState.Off) {
      effTurbo = PowerState.Off;
      effSleep = SleepModeState.Off;
      effFan = FanSpeed.Auto; // Typically, fan speed resets or is non-applicable when off
    } else { // Power is ON
      if (effTurbo === PowerState.On) {
        effSleep = SleepModeState.Off; // Turbo and Sleep are mutually exclusive
        effFan = FanSpeed.Turbo;     // Turbo implies max fan speed
      } else if ((typeof effSleep === 'string' && effSleep !== 'off') || effSleep === SleepModeState.On) {
        effTurbo = PowerState.Off; // Sleep and Turbo are mutually exclusive
        if (options.fanSpeed === undefined && (effFan === FanSpeed.Turbo || effFan === FanSpeed.Auto || current.fan_mode === FanSpeed.Turbo)) {
          effFan = FanSpeed.Low; // If sleep is turning on, and fan was Turbo/Auto, set to Low
        }
      }
      // If turbo is being turned OFF, and fan was Turbo (because of it), and no new fanSpeed is specified
      if (options.turbo === PowerState.Off && current.opt_turbo === PowerState.On && effFan === FanSpeed.Turbo) {
        if (options.fanSpeed === undefined) {
          effFan = FanSpeed.Auto; // Revert fan to Auto
        }
      }

      if (effFan === FanSpeed.Turbo && effTurbo === PowerState.Off) {
        effTurbo = PowerState.On; // If fan is set to Turbo, ensure Turbo mode is on
        if ((typeof effSleep === 'string' && effSleep !== 'off') || effSleep === SleepModeState.On) {
          effSleep = SleepModeState.Off; // Ensure sleep is off if turbo is forced by fan speed
        }
      }
    }

    const payload: Record<string, string | number | undefined> = {};
    const optimisticUpdate: Partial<AirConditionerStatus> = {};

    // Always include TurnOn, even if it's to turn off.
    payload.TurnOn = effPower;
    optimisticUpdate.is_on = effPower;

    // These are only sent if power is ON as per original logic
    if (effPower === PowerState.On) {
      payload.BaseMode = effMode as string; 
      optimisticUpdate.operation_mode = effMode;
      payload.SetTemp = effTemp;
      optimisticUpdate.target_temp = effTemp;
      payload.WindSpeed = effFan as string; 
      optimisticUpdate.fan_mode = effFan;

      // Handle SwingMode
      switch (effSwing) {
      case SwingMode.Off:
        payload.WindDirection_H = 'off';
        payload.WindDirection_V = 'off';
        break;
      case SwingMode.Vertical:
        payload.WindDirection_H = 'off';
        payload.WindDirection_V = 'on';
        break;
      case SwingMode.Horizontal:
        payload.WindDirection_H = 'on';
        payload.WindDirection_V = 'off';
        break;
      case SwingMode.Both:
        payload.WindDirection_H = 'on';
        payload.WindDirection_V = 'on';
        break;
      }
      optimisticUpdate.swing_mode = effSwing;

      payload.Opt_super = effTurbo;
      optimisticUpdate.opt_turbo = effTurbo; // Make sure turbo is in optimistic update

      const isSleepOn = (typeof effSleep === 'string' && effSleep !== 'off') || effSleep === SleepModeState.On;
      payload.Opt_sleepMode = isSleepOn ? 'sleepMode1:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0' : SleepModeState.Off;
      optimisticUpdate.opt_sleepMode = isSleepOn ? SleepModeState.On : SleepModeState.Off;
      optimisticUpdate.opt_sleep = isSleepOn ? PowerState.On : PowerState.Off;

      if (effDisplay !== undefined) {
        payload.Opt_display = effDisplay;
        optimisticUpdate.opt_display = effDisplay;
      }

      if (effEco !== undefined) {
        payload.Opt_eco = effEco;
        optimisticUpdate.opt_eco = effEco;
      }

      if (effBeep !== undefined) {
        payload.Opt_beep = effBeep;
        optimisticUpdate.opt_beep = effBeep;
      }

    } else { // Power OFF payload specifics
      payload.Opt_sleepMode = SleepModeState.Off; 
      payload.Opt_super = PowerState.Off;
      payload.WindSpeed = FanSpeed.Auto; 

      optimisticUpdate.opt_sleepMode = SleepModeState.Off;
      optimisticUpdate.opt_sleep = PowerState.Off;
      optimisticUpdate.opt_turbo = PowerState.Off;
      optimisticUpdate.fan_mode = FanSpeed.Auto; 
      optimisticUpdate.operation_mode = effMode; 
      optimisticUpdate.target_temp = effTemp;   
      optimisticUpdate.swing_mode = effSwing; 

      if (effDisplay !== undefined) {
        optimisticUpdate.opt_display = PowerState.Off; 
      }
      if (effEco !== undefined) {
        optimisticUpdate.opt_eco = PowerState.Off; 
      }
      if (effBeep !== undefined) {
        optimisticUpdate.opt_beep = effBeep; 
      }
    }
    await this._sendCommandPayload(payload, optimisticUpdate, 'setDeviceOptions');
  }

  // --- Start of Refactored Combo Methods for Step 3 ---

  public async setPower(state: PowerState): Promise<void> {
    if (state === PowerState.On) {
      await this.setDeviceOptions({ power: PowerState.On });
    } else {
      const existingMode = this.lastStatus?.operation_mode;
      let modeToSet: OperationMode;

      if (existingMode && Object.values(OperationMode).includes(existingMode as OperationMode)) {
        modeToSet = existingMode as OperationMode;
      } else {
        // If existingMode is a string not in enum, or undefined, default to Auto.
        modeToSet = OperationMode.Auto;
      }
      
      const currentTemp = this.lastStatus?.target_temp || 24; // Default temp if not available
      await this.setDeviceOptions({ power: PowerState.Off, mode: modeToSet, temp: currentTemp });
    }
  }

  public async setMode(mode: OperationMode, targetTemp?: number): Promise<void> {
    await this.setDeviceOptions({ power: PowerState.On, mode: mode, temp: targetTemp });
  }

  public async setFanAndSleep(fanSpeed: FanSpeed, sleep: SleepModeState | string): Promise<void> {
    await this.setDeviceOptions({ power: PowerState.On, fanSpeed: fanSpeed, sleep: sleep });
  }

  public async setSleepAndTurbo(sleep: SleepModeState | string, turbo: PowerState): Promise<void> {
    await this.setDeviceOptions({ power: PowerState.On, sleep: sleep, turbo: turbo });
  }

  public async setFanOnly(fanSpeed: FanSpeed): Promise<void> {
    await this.setDeviceOptions({ power: PowerState.On, mode: OperationMode.FanOnly, fanSpeed: fanSpeed });
  }

  // --- End of Refactored Combo Methods ---

  private mapWindDirectionToSwingMode(status: StatusUpdateMsg): string {
    const value =
      (status.WindDirection_H[0] === 'on' ? 1 : 0) |
      (status.WindDirection_V[0] === 'on' ? 2 : 0);
    return { 0: 'Off', 1: 'Horizontal', 2: 'Vertical', 3: 'Both' }[value] || 'Off';
  }

  async updateState(force: boolean = false): Promise<AirConditionerStatus> {
    const now = Date.now();
    if (!force && this.lastSyncTime > 0) {
      const wait = this.lastSeq === 0 ? SHORT_WAIT : LONG_WAIT;
      if (now - this.lastSyncTime < wait && this.lastStatus) {
        this.emit(
          'debug',
          `Throttling updateState: returning cached status. Elapsed ${now - this.lastSyncTime}ms < ${wait}ms`,
        );
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

      // Normalize fan_mode: convert numeric strings to FanSpeed enum
      const rawFan = statusUpdateMsg.WindSpeed[0];
      let fanMode: FanSpeed | string;
      if (/^\d+$/.test(rawFan)) {
        const pct = parseInt(rawFan, 10);
        fanMode = (
          (Object.entries(FanSpeedPercentMap) as [FanSpeed, number][]).find(([, v]) => v === pct) || [FanSpeed.Auto]
        )[0];
      } else {
        fanMode = rawFan as FanSpeed;
      }

      const status: AirConditionerStatus = {
        current_temp: parseFloat(statusUpdateMsg.IndoorTemp[0]),
        target_temp: parseFloat(statusUpdateMsg.SetTemp[0]),
        operation_mode: statusUpdateMsg.BaseMode[0] as OperationMode,
        fan_mode: fanMode,
        is_on: statusUpdateMsg.TurnOn[0] as PowerState,
        swing_mode: this.mapWindDirectionToSwingMode(statusUpdateMsg) as SwingMode,
        opt_display: statusUpdateMsg.Opt_display ? statusUpdateMsg.Opt_display[0] as PowerState : undefined,
        opt_turbo: statusUpdateMsg.Opt_super
          ? statusUpdateMsg.Opt_super[0] as PowerState
          : undefined, // Assuming Opt_super maps to opt_turbo
        opt_sleepMode: statusUpdateMsg.Opt_sleepMode ? statusUpdateMsg.Opt_sleepMode[0] : undefined,
        outdoor_temp: statusUpdateMsg.OutdoorTemp && statusUpdateMsg.OutdoorTemp[0] !== undefined
          ? parseFloat(statusUpdateMsg.OutdoorTemp[0])
          : undefined,
      };

      // Derive turbo state when fan_mode indicates Turbo
      if (status.fan_mode === FanSpeed.Turbo) {
        status.opt_turbo = PowerState.On;
      }

      this.emit('debug', `Parsed status: ${JSON.stringify(status)}`);
      this.lastSyncTime = Date.now();
      this.lastStatus = status;
      return status;
    } catch (error) {
      this.emit('error', `Error parsing response: ${error}`);
      throw error;
    }
  }
}

// Export the class directly instead of a default export
export default AirConditionerAPI;