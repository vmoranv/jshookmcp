import chalk from 'chalk';

const SENSITIVE_KEYS = /^(authorization|cookie|token|secret|password|api[_-]?key)$/i;

/** JSON.stringify replacer that redacts sensitive fields. */
function sensitiveReplacer(key: string, value: unknown): unknown {
  if (key && SENSITIVE_KEYS.test(key) && typeof value === 'string') {
    return '[REDACTED]';
  }
  return value;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = 'info') {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  private formatMessage(level: LogLevel, message: string, ...args: unknown[]): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    let formattedArgs = '';
    if (args.length > 0) {
      try {
        formattedArgs = ' ' + JSON.stringify(args, sensitiveReplacer, undefined);
      } catch {
        formattedArgs = ' [unserializable]';
      }
    }
    return `${prefix} ${message}${formattedArgs}`;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.error(chalk.gray(this.formatMessage('debug', message, ...args)));
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.error(chalk.blue(this.formatMessage('info', message, ...args)));
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.error(chalk.yellow(this.formatMessage('warn', message, ...args)));
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      console.error(chalk.red(this.formatMessage('error', message, ...args)));
    }
  }

  success(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.error(chalk.green(this.formatMessage('info', message, ...args)));
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }
}

export const logger = new Logger((process.env.LOG_LEVEL as LogLevel) || 'info');
