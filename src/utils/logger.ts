import chalk from 'chalk';
import { createWriteStream, mkdir } from 'node:fs';
import { dirname } from 'node:path';
import { chmod } from 'node:fs/promises';

const SENSITIVE_KEYS =
  /^(auth(orization)?|cookie|set[_-]?cookie|x[_-]?api[_-]?key|token|access[_-]?token|refresh[_-]?token|id[_-]?token|secret|client[_-]?secret|password|passwd|api[_-]?key|private[_-]?key|credentials?|session[_-]?id|csrf[_-]?token)$/i;

const SENSITIVE_VALUE_PATTERNS =
  /^(Bearer\s+\S|eyJ[A-Za-z0-9_-]{10,}|[A-Fa-f0-9]{32,}|sk[_-][A-Za-z0-9]{20,})/;

function sensitiveReplacer(key: string, value: unknown): unknown {
  if (key && SENSITIVE_KEYS.test(key) && typeof value === 'string') {
    return '[REDACTED]';
  }
  // Value-based fallback: redact strings that look like tokens/secrets regardless of key
  if (typeof value === 'string' && SENSITIVE_VALUE_PATTERNS.test(value)) {
    return '[REDACTED]';
  }
  return value;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerOptions {
  level?: LogLevel;
  filePath?: string;
}

class Logger {
  private level: LogLevel;
  private fileStream?: ReturnType<typeof createWriteStream>;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level || 'info';
    if (options.filePath) {
      this.initializeFileLogging(options.filePath);
    }
  }

  private async initializeFileLogging(filePath: string): Promise<void> {
    try {
      // Ensure directory exists with secure permissions (0755)
      const dir = dirname(filePath);
      await mkdir(dir, { recursive: true, mode: 0o755 });

      // Create write stream for log file
      this.fileStream = createWriteStream(filePath, { flags: 'a' });

      // Set restrictive permissions on log file (0600) after creation
      this.fileStream.on('open', async (fd) => {
        try {
          await chmod(filePath, 0o600);
        } catch (error) {
          // Log to console if file permission setting fails
          console.error(`Failed to set secure permissions on log file ${filePath}:`, error);
        }
      });
    } catch (error) {
      console.error(`Failed to initialize file logging to ${filePath}:`, error);
    }
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
    return `${prefix} ${message}${formattedArgs}\n`;
  }

  private writeToFile(message: string): void {
    if (this.fileStream) {
      this.fileStream.write(message);
    }
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      const formatted = this.formatMessage('debug', message, ...args);
      // stderr only \u2014 stdout reserved for MCP frames
      console.error(chalk.gray(formatted.trimEnd()));
      this.writeToFile(formatted);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      const formatted = this.formatMessage('info', message, ...args);
      console.error(chalk.blue(formatted.trimEnd()));
      this.writeToFile(formatted);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      const formatted = this.formatMessage('warn', message, ...args);
      console.error(chalk.yellow(formatted.trimEnd()));
      this.writeToFile(formatted);
    }
  }

  error(message: string, ...args: unknown[]): void {
    /* v8 ignore next 3 */
    if (this.shouldLog('error')) {
      const formatted = this.formatMessage('error', message, ...args);
      console.error(chalk.red(formatted.trimEnd()));
      this.writeToFile(formatted);
    }
  }

  success(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      const formatted = this.formatMessage('info', message, ...args);
      console.error(chalk.green(formatted.trimEnd()));
      this.writeToFile(formatted);
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  close(): void {
    if (this.fileStream) {
      this.fileStream.end();
      this.fileStream = undefined;
    }
  }
}

export const logger = new Logger({
  level: (process.env.LOG_LEVEL as LogLevel) || 'info',
  filePath: process.env.LOG_FILE,
});
