const ANSI = {
  gray: '\x1b[90m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  reset: '\x1b[0m',
} as const;

const colorize = (color: string, text: string) => `${color}${text}${ANSI.reset}`;

const SENSITIVE_KEYS =
  /^(auth(orization)?|cookie|set[_-]?cookie|x[_-]?api[_-]?key|token|access[_-]?token|refresh[_-]?token|id[_-]?token|secret|client[_-]?secret|password|passwd|api[_-]?key|private[_-]?key|credentials?|session[_-]?id|csrf[_-]?token)$/i;

/** Patterns that look like secrets in values (Bearer tokens, JWTs, long hex strings). */
const SENSITIVE_VALUE_PATTERNS =
  /^(Bearer\s+\S|eyJ[A-Za-z0-9_-]{10,}|[A-Fa-f0-9]{32,}|sk[_-][A-Za-z0-9]{20,})/;

/** JSON.stringify replacer that redacts sensitive fields. */
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
export type LogListener = (level: LogLevel, message: string, args: unknown[]) => void;

class Logger {
  private level: LogLevel;
  private listeners: LogListener[] = [];

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

  private emit(level: LogLevel, message: string, args: unknown[]): void {
    for (const listener of this.listeners) {
      try {
        listener(level, message, args);
      } catch {
        // Suppress listener errors to prevent crashing the main log flow
      }
    }
  }

  onLog(listener: LogListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.error(colorize(ANSI.gray, this.formatMessage('debug', message, ...args)));
      this.emit('debug', message, args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.error(colorize(ANSI.blue, this.formatMessage('info', message, ...args)));
      this.emit('info', message, args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.error(colorize(ANSI.yellow, this.formatMessage('warn', message, ...args)));
      this.emit('warn', message, args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    /* v8 ignore next 4 */
    if (this.shouldLog('error')) {
      console.error(colorize(ANSI.red, this.formatMessage('error', message, ...args)));
      this.emit('error', message, args);
    }
  }

  success(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.error(colorize(ANSI.green, this.formatMessage('info', message, ...args)));
      this.emit('info', message, args); // success maps to info for MCP
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }
}

export const logger = new Logger((process.env.LOG_LEVEL as LogLevel) || 'info');
