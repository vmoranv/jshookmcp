/**
 * MCP Log Transport — sends structured log notifications to the connected Host
 * via the MCP `notifications/message` protocol.
 *
 * This is an **additive** channel. It does NOT replace the existing stderr
 * logger (`src/utils/logger.ts`). Structured events are sent only when
 * `MCP_LOG_ENABLED` is true (default: false).
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type McpLogLevel = 'debug' | 'info' | 'warning' | 'error';

const LEVEL_ORDER: Record<McpLogLevel, number> = {
  debug: 0,
  info: 1,
  warning: 2,
  error: 3,
};

/** Mapping from our McpLogLevel to the MCP SDK's LoggingLevel string literal. */
const TO_SDK_LEVEL: Record<McpLogLevel, string> = {
  debug: 'debug',
  info: 'info',
  warning: 'warning',
  error: 'error',
};

export class McpLogTransport {
  private server: McpServer | null = null;
  private minLevel: McpLogLevel = 'info';
  private enabled = false;
  private filePath: string | undefined;

  /**
   * Bind to an MCP Server instance and enable/disable transport.
   */
  attach(server: McpServer, enabled: boolean): void {
    this.server = server;
    this.enabled = enabled;
  }

  /**
   * Update the enabled flag at runtime.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Set the minimum log level. Messages below this level are silently dropped.
   */
  setLevel(level: McpLogLevel): void {
    this.minLevel = level;
  }

  /**
   * Enable file logging — all log messages are appended to a timestamped file
   * in the given directory. Failures are swallowed so the main flow is never blocked.
   */
  enableFileLogging(logDir: string): void {
    try {
      mkdirSync(logDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      this.filePath = join(logDir, `jshookmcp-${timestamp}.log`);
    } catch {
      // File creation failure does not block the main flow
    }
  }

  /**
   * Return the current log file path, or undefined when file logging is disabled.
   */
  getFilePath(): string | undefined {
    return this.filePath;
  }

  /**
   * Send a structured log message to the connected Host.
   *
   * Silently no-ops when:
   *  - transport is disabled (`MCP_LOG_ENABLED=false`)
   *  - no server is attached
   *  - the message level is below the configured minimum
   */
  log(level: McpLogLevel, logger: string, data: Record<string, unknown>): void {
    if (!this.enabled || !this.server) return;
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;

    void this.server.server
      .sendLoggingMessage({
        level: TO_SDK_LEVEL[level] as never,
        logger,
        data: JSON.stringify(data),
      })
      .catch(() => undefined);

    this.writeToFile(level, logger, data);
  }

  private writeToFile(level: McpLogLevel, logger: string, data: Record<string, unknown>): void {
    if (!this.filePath) return;
    try {
      const line =
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level,
          logger,
          ...data,
        }) + '\n';
      appendFileSync(this.filePath, line, 'utf8');
    } catch {
      // Write failure does not block the main flow
    }
  }

  debug(logger: string, data: Record<string, unknown>): void {
    this.log('debug', logger, data);
  }

  info(logger: string, data: Record<string, unknown>): void {
    this.log('info', logger, data);
  }

  warning(logger: string, data: Record<string, unknown>): void {
    this.log('warning', logger, data);
  }

  error(logger: string, data: Record<string, unknown>): void {
    this.log('error', logger, data);
  }
}
