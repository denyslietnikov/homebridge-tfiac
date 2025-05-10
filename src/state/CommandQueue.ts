// filepath: src/state/CommandQueue.ts
import { EventEmitter } from 'events';
import { DeviceState } from './DeviceState.js';
import AirConditionerAPI from '../AirConditionerAPI.js';
import { Logger } from 'homebridge';
import { PowerState, FanSpeed, SleepModeState } from '../enums.js';

/**
 * CommandType represents the different types of commands that can be executed.
 */
export enum CommandType {
  POWER = 'power',
  MODE = 'mode',
  FAN_SPEED = 'fanSpeed',
  TEMPERATURE = 'temperature',
  SWING = 'swing',
  SLEEP = 'sleep',
  TURBO = 'turbo',
  ECO = 'eco',
  DISPLAY = 'display',
  BEEP = 'beep',
  SLEEP_AND_TURBO = 'sleepAndTurbo',
  FAN_AND_SLEEP = 'fanAndSleep',
}

/**
 * Type definitions for command parameters
 */
export type CommandParams = {
  [CommandType.POWER]: { value: boolean };
  [CommandType.MODE]: { mode: string };
  [CommandType.FAN_SPEED]: { speed: string };
  [CommandType.TEMPERATURE]: { temperature: number };
  [CommandType.SWING]: { mode: string };
  [CommandType.SLEEP]: { state: string };
  [CommandType.TURBO]: { state: boolean };
  [CommandType.ECO]: { state: string };
  [CommandType.DISPLAY]: { state: string };
  [CommandType.BEEP]: { state: string };
  [CommandType.SLEEP_AND_TURBO]: { fanSpeed: string; sleepState: string };
  [CommandType.FAN_AND_SLEEP]: { fanSpeed: string; sleepState: string };
};

/**
 * Command interface represents a command that can be executed.
 */
export interface Command {
  type: CommandType;
  params: Record<string, unknown>;
  id: string;
  timestamp: number;
  deviceState: DeviceState;
  retryCount: number;
}

/**
 * CommandQueue manages the queue of commands to be executed.
 * It optimistically updates the DeviceState and then sends the command to the device.
 * It handles retries and deduplication of commands.
 */
export class CommandQueue extends EventEmitter {
  private queue: Command[] = [];
  private isProcessing = false;
  private api: AirConditionerAPI;
  private deviceState: DeviceState;
  private logger: Logger;
  private lastSyncTime = 0;
  private maxRetries = 3;
  private retryDelay = 1000; // 1 second
  private commandTimeout = 5000; // 5 seconds
  private syncDelay = 1000; // 1 second
  
  constructor(api: AirConditionerAPI, deviceState: DeviceState, logger: Logger) {
    super();
    this.api = api;
    this.deviceState = deviceState;
    this.logger = logger;
  }

  /**
   * Add a command to the queue and start processing if not already processing.
   * @param type The type of command.
   * @param params The parameters for the command.
   * @returns A promise that resolves when the command is executed.
   */
  public async addCommand(type: CommandType, params: Record<string, unknown>): Promise<void> {
    const command: Command = {
      type,
      params,
      id: `${type}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      timestamp: Date.now(),
      deviceState: this.deviceState,
      retryCount: 0,
    };

    // Check for duplicate commands and replace them
    this.deduplicateCommand(command);

    // Add to queue
    this.queue.push(command);
    this.logger.debug(`[CommandQueue] Added command to queue: ${command.type}, id: ${command.id}`);
    this.emit('queued', command);

    // Start processing if not already processing
    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  /**
   * Deduplicate commands in the queue.
   * If a command of the same type is already in the queue, remove it.
   * @param newCommand The new command to check against the queue.
   */
  private deduplicateCommand(newCommand: Command): void {
    // Find commands of the same type
    const duplicates = this.queue.filter(cmd => cmd.type === newCommand.type);
    
    if (duplicates.length > 0) {
      this.logger.debug(`[CommandQueue] Found ${duplicates.length} duplicate(s) for command type: ${newCommand.type}`);
      
      // Remove duplicates from queue
      this.queue = this.queue.filter(cmd => !duplicates.includes(cmd));
      
      // Log the deduplication
      for (const dup of duplicates) {
        this.logger.debug(`[CommandQueue] Removed duplicate command: ${dup.type}, id: ${dup.id}`);
        this.emit('deduped', dup);
      }
    }
  }

  /**
   * Process the queue of commands.
   * Execute each command in order and wait for it to complete before moving to the next.
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    this.logger.debug(`[CommandQueue] Starting to process queue with ${this.queue.length} command(s)`);

    while (this.queue.length > 0) {
      const command = this.queue[0];
      try {
        this.logger.info(`[CommandQueue][TX] Executing command: ${command.type}`);
        this.emit('executing', command);
        
        await this.executeCommand(command);
        
        // Command successful, remove from queue
        this.queue.shift();
        this.logger.info(`[CommandQueue][ACK] Command successful: ${command.type}`);
        this.emit('executed', command);
        
        // Schedule device state sync after successful command
        this.scheduleSyncDeviceState();
      } catch (error) {
        this.logger.error(`[CommandQueue] Error executing command ${command.type}: ${error}`);
        this.emit('error', { command, error });
        
        // Check if we should retry
        if (command.retryCount < this.maxRetries) {
          command.retryCount++;
          this.logger.debug(`[CommandQueue][RETRY#${command.retryCount}] Will retry command: ${command.type}`);
          this.emit('retry', { command, retryCount: command.retryCount });
          
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        } else {
          // Max retries reached, remove from queue
          this.queue.shift();
          this.logger.error(`[CommandQueue] Max retries reached for command: ${command.type}`);
          this.emit('maxRetriesReached', command);
          
          // Sync with device to get the actual state
          this.scheduleSyncDeviceState();
        }
      }
    }

    this.isProcessing = false;
    this.logger.debug('[CommandQueue] Queue processing completed');
    this.emit('queueEmpty');
  }

  /**
   * Execute a command by making the appropriate API call.
   * @param command The command to execute.
   */
  private async executeCommand(command: Command): Promise<void> {
    // Execute with timeout
    return Promise.race([
      this.doExecuteCommand(command),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error(`Command ${command.type} timed out`)), this.commandTimeout),
      ),
    ]);
  }

  /**
   * Actually execute the command based on its type.
   * @param command The command to execute.
   */  private async doExecuteCommand(command: Command): Promise<void> {
    switch (command.type) {
    case CommandType.POWER:
      if (command.params.value as boolean) {
        await this.api.turnOn();
      } else {
        await this.api.turnOff();
      }
      break;
        
    case CommandType.MODE:
      await this.api.setAirConditionerState('operation_mode', command.params.mode as string);
      break;
        
    case CommandType.FAN_SPEED:
      await this.api.setFanSpeed(command.params.speed as unknown as FanSpeed);
      break;
        
    case CommandType.TEMPERATURE:
      await this.api.setAirConditionerState('target_temp', command.params.temperature as number);
      break;
        
    case CommandType.SWING:
      await this.api.setSwingMode(command.params.mode as string);
      break;
        
    case CommandType.SLEEP:
      await this.api.setSleepState(command.params.state as string);
      break;
        
    case CommandType.TURBO:
      await this.api.setFanSpeed((command.params.state as boolean) ? 'Turbo' : 'Auto');
      break;
        
    case CommandType.ECO:
      await this.api.setEcoState(command.params.state as unknown as PowerState);
      break;
        
    case CommandType.DISPLAY:
      await this.api.setDisplayState(command.params.state as unknown as PowerState);
      break;
        
    case CommandType.BEEP:
      await this.api.setBeepState(command.params.state as unknown as PowerState);
      break;
        
    case CommandType.SLEEP_AND_TURBO:
      await this.api.setSleepAndTurbo(
        command.params.fanSpeed as unknown as FanSpeed, 
        command.params.sleepState as unknown as SleepModeState,
      );
      break;
        
    case CommandType.FAN_AND_SLEEP:
      await this.api.setFanAndSleepState(
        command.params.fanSpeed as unknown as FanSpeed, 
        command.params.sleepState as unknown as SleepModeState,
      );
      break;
        
    default:
      throw new Error(`Unknown command type: ${command.type}`);
    }
  }

  /**
   * Schedule a sync of the device state after a command is executed.
   */
  private scheduleSyncDeviceState(): void {
    const now = Date.now();
    
    // Only schedule if enough time has passed since the last sync
    if (now - this.lastSyncTime >= this.syncDelay) {
      this.lastSyncTime = now;
      
      setTimeout(async () => {
        try {
          this.logger.debug('[CommandQueue] Syncing device state after command execution');
          const status = await this.api.updateState(true);
          this.deviceState.updateFromDevice(status);
          this.logger.debug('[CommandQueue] Device state synced successfully');
        } catch (error) {
          this.logger.error('[CommandQueue] Error syncing device state:', error);
        }
      }, this.syncDelay);
    }
  }

  /**
   * Clear the command queue.
   */
  public clear(): void {
    this.queue = [];
    this.isProcessing = false;
    this.logger.debug('[CommandQueue] Queue cleared');
    this.emit('queueCleared');
  }
}

export default CommandQueue;
