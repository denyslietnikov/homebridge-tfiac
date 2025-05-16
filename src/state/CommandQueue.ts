import { AirConditionerAPI, PartialDeviceOptions } from '../AirConditionerAPI.js';
import { Logger } from 'homebridge';
import { EventEmitter } from 'events';
import { DeviceState } from './DeviceState.js';

// Command type remains the same
type Command = PartialDeviceOptions;

interface QueuedCommand {
  command: Command;
  resolve: (value: unknown) => void;
  reject: (reason?: Error) => void;
  timestamp: number;
  attempt: number;
}

// Event payload types
export interface CommandExecutedEvent {
  command: Command;
}

export interface CommandErrorEvent {
  command: Command;
  error: Error;
}

export interface CommandRetryEvent {
  command: Command;
  retryCount: number;
  error: Error;
}

export interface CommandMaxRetriesReachedEvent {
  command: Command;
  error: Error;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const COMMAND_MERGE_WINDOW_MS = 500;

export class CommandQueue extends EventEmitter {
  private queue: QueuedCommand[] = [];
  private isProcessing = false;
  private readonly api: AirConditionerAPI;
  private readonly log: Logger;
  private readonly deviceState: DeviceState;
  private lastCommandTime: number = 0;
  private readonly minRequestDelayMs: number;

  constructor(api: AirConditionerAPI, deviceState: DeviceState, log: Logger, minRequestDelayMs: number = 500) {
    super();
    this.api = api;
    this.deviceState = deviceState;
    this.log = log;
    this.minRequestDelayMs = minRequestDelayMs;
  }

  public async enqueueCommand(command: Command): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const now = Date.now();

      // Check if there's a command in the queue that can be merged with
      const lastQueuedCommand = this.queue[this.queue.length - 1];
      if (
        lastQueuedCommand &&
        (now - lastQueuedCommand.timestamp) < COMMAND_MERGE_WINDOW_MS
      ) {
        const originalCmdJson = JSON.stringify(lastQueuedCommand.command);
        const newCmdJson = JSON.stringify(command);
        lastQueuedCommand.command = { ...lastQueuedCommand.command, ...command };
        lastQueuedCommand.timestamp = now;
        this.log.info(`[CommandQueue][MERGE] Original: ${originalCmdJson}, New: ${newCmdJson}, Result: ${JSON.stringify(lastQueuedCommand.command)}`);
        
        // Create callbacks that will call both resolvers/rejecters
        const originalResolve = lastQueuedCommand.resolve;
        lastQueuedCommand.resolve = (val) => {
          originalResolve(val);
          resolve(val);
        };
        
        const originalReject = lastQueuedCommand.reject;
        lastQueuedCommand.reject = (err) => {
          originalReject(err);
          reject(err);
        };
        return;
      }

      const queuedCommand: QueuedCommand = {
        command,
        resolve,
        reject,
        timestamp: now,
        attempt: 1,
      };
      this.queue.push(queuedCommand);
      this.log.info(`[CommandQueue][ENQUEUE] Enqueued command: ${JSON.stringify(command)}`);
      
      // Only start processing if we're not already processing
      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const queuedItem = this.queue.shift();
    if (!queuedItem) {
      this.isProcessing = false;
      return;
    }
    const { command, resolve, reject, attempt, timestamp } = queuedItem;

    const timeSinceLastCommand = Date.now() - this.lastCommandTime;
    const requiredDelay = this.minRequestDelayMs;
    if (this.lastCommandTime !== 0 && timeSinceLastCommand < requiredDelay) {
      const delay = requiredDelay - timeSinceLastCommand;
      this.log.debug(`[CommandQueue] Delaying command execution by ${delay}ms to respect minRequestDelay.`);
      await new Promise(r => setTimeout(r, delay));
    }

    this.log.info(`[CommandQueue][TX] Attempt #${attempt} for command: ${JSON.stringify(command)}`);

    try {
      await this.api.setDeviceOptions(command);
      this.log.info(`[CommandQueue][ACK] Successfully executed command: ${JSON.stringify(command)}`);
      this.lastCommandTime = Date.now();
      this.emit('executed', { command } as CommandExecutedEvent);

      // Step 6: Rapid Feedback After Commands
      this.log.debug(`[CommandQueue] Scheduling rapid feedback update for command: ${JSON.stringify(command)}`);
      setTimeout(async () => {
        try {
          this.log.debug(`[CommandQueue][RAPID_FEEDBACK] Executing update for: ${JSON.stringify(command)}`);
          // Call updateState with force=true to bypass throttling
          const status = await this.api.updateState(true); 
          if (status) {
            const changed = this.deviceState.updateFromDevice(status);
            if (changed) {
              this.log.info(`[CommandQueue][RAPID_FEEDBACK] Device state updated after command ${JSON.stringify(command)}.`);
            } else {
              this.log.debug(`[CommandQueue][RAPID_FEEDBACK] No state changes detected after command ${JSON.stringify(command)}.`);
            }
          } else {
            this.log.warn(`[CommandQueue][RAPID_FEEDBACK] Failed to get status for command ${JSON.stringify(command)}.`);
          }
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          this.log.error(`[CommandQueue][RAPID_FEEDBACK] Error during state update for command ${JSON.stringify(command)}: ${err.message}`);
        }
      }, 2000); // 2-second delay

      resolve(undefined);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.log.error(`[CommandQueue][ERROR] Error executing command (attempt ${attempt}): ${JSON.stringify(command)}, Error: ${err.message}`);
      if (attempt < MAX_RETRIES) {
        this.log.info(`[CommandQueue][RETRY#${attempt + 1}] Retrying command in ${RETRY_DELAY_MS}ms. Command: ${JSON.stringify(command)}`);
        this.emit('retry', { command, retryCount: attempt + 1, error: err } as CommandRetryEvent);
        this.queue.unshift({ command, resolve, reject, timestamp, attempt: attempt + 1 });
        setTimeout(() => {
          this.isProcessing = false;
          this.processQueue();
        }, RETRY_DELAY_MS);
        return;
      } else {
        this.log.error(`[CommandQueue][FAIL] Command failed after ${MAX_RETRIES} attempts: ${JSON.stringify(command)}, Error: ${err.message}`);
        this.emit('maxRetriesReached', { command, error: err } as CommandMaxRetriesReachedEvent);
        reject(err);
      }
    }

    this.isProcessing = false;
    if (this.queue.length > 0) {
      this.processQueue();
    }
  }
}
