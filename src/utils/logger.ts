/**
 * Logger - Simple structured logging utility for webcodecs-node
 *
 * By default, logging is disabled to avoid cluttering user output.
 * Enable via environment variable: WEBCODECS_DEBUG=1
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  context: string;
  message: string;
  timestamp: number;
  data?: unknown;
}

/**
 * Check if debug mode is enabled via environment variable
 */
function isDebugEnabled(): boolean {
  if (typeof process !== 'undefined' && process.env) {
    return process.env.WEBCODECS_DEBUG === '1' || process.env.WEBCODECS_DEBUG === 'true';
  }
  return false;
}

/**
 * Global debug mode flag (can be set programmatically)
 */
let globalDebugMode = isDebugEnabled();

/**
 * Enable or disable debug logging globally
 */
export function setDebugMode(enabled: boolean): void {
  globalDebugMode = enabled;
}

/**
 * Check if debug mode is currently enabled
 */
export function isDebugMode(): boolean {
  return globalDebugMode;
}

/**
 * Logger class for structured logging
 */
export class Logger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  /**
   * Log a debug message (only in debug mode)
   */
  debug(message: string, data?: unknown): void {
    if (!globalDebugMode) return;
    this._log('debug', message, data);
  }

  /**
   * Log an info message (only in debug mode)
   */
  info(message: string, data?: unknown): void {
    if (!globalDebugMode) return;
    this._log('info', message, data);
  }

  /**
   * Log a warning message (only in debug mode)
   */
  warn(message: string, data?: unknown): void {
    if (!globalDebugMode) return;
    this._log('warn', message, data);
  }

  /**
   * Log an error message (only in debug mode)
   * Note: Actual errors should still be reported via error callbacks
   */
  error(message: string, data?: unknown): void {
    if (!globalDebugMode) return;
    this._log('error', message, data);
  }

  /**
   * Internal logging implementation
   */
  private _log(level: LogLevel, message: string, data?: unknown): void {
    const entry: LogEntry = {
      level,
      context: this.context,
      message,
      timestamp: Date.now(),
    };

    if (data !== undefined) {
      entry.data = data;
    }

    const prefix = `[webcodecs:${this.context}]`;
    const logMessage = `${prefix} ${message}`;

    switch (level) {
      case 'debug':
        console.debug(logMessage, data !== undefined ? data : '');
        break;
      case 'info':
        console.info(logMessage, data !== undefined ? data : '');
        break;
      case 'warn':
        console.warn(logMessage, data !== undefined ? data : '');
        break;
      case 'error':
        console.error(logMessage, data !== undefined ? data : '');
        break;
    }
  }
}

/**
 * Create a logger for a specific context
 */
export function createLogger(context: string): Logger {
  return new Logger(context);
}
