import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger, Logger } from '@utils/logger';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('logger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.setLevel('debug');
  });

  afterEach(() => {
    logger.setLevel('info');
    vi.restoreAllMocks();
  });

  it('emits debug logs when level is debug', () => {
    logger.debug('debug message', { x: 1 });

    expect(console.error).toHaveBeenCalledTimes(1);
    const output = String((console.error as any).mock.calls[0]![0]);
    expect(output).toContain('[DEBUG]');
    expect(output).toContain('debug message');
  });

  it('respects level filtering and suppresses lower-priority logs', () => {
    logger.setLevel('warn');

    logger.info('hidden info');
    logger.warn('visible warn');

    expect(console.error).toHaveBeenCalledTimes(1);
    const output = String((console.error as any).mock.calls[0]![0]);
    expect(output).toContain('[WARN]');
    expect(output).toContain('visible warn');
  });

  it('redacts sensitive keys from structured payloads', () => {
    logger.info('auth payload', {
      token: 'plain-token-value',
      authorization: 'Bearer abcdef',
      normalField: 'safe',
    });

    const output = String((console.error as any).mock.calls[0]![0]);
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('plain-token-value');
    expect(output).not.toContain('Bearer abcdef');
    expect(output).toContain('safe');
  });

  it('redacts secret-like values even when keys are not sensitive', () => {
    logger.info('value redaction', {
      harmless: 'Bearer very-secret-token',
      another: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature',
    });

    const output = String((console.error as any).mock.calls[0]![0]);
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('very-secret-token');
    expect(output).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
  });

  it('falls back to [unserializable] for circular arguments', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    logger.info('circular', circular);

    const output = String((console.error as any).mock.calls[0]![0]);
    expect(output).toContain('[unserializable]');
  });

  it('success logs use info-level threshold and include info prefix', () => {
    logger.setLevel('info');
    logger.success('operation completed');

    expect(console.error).toHaveBeenCalledTimes(1);
    const output = String((console.error as any).mock.calls[0]![0]);
    expect(output).toContain('[INFO]');
    expect(output).toContain('operation completed');
  });

  it('emits error logs correctly', () => {
    logger.setLevel('error');
    logger.error('critical failure', { x: 2 });
    expect(console.error).toHaveBeenCalledTimes(1);
    const output = String((console.error as any).mock.calls[0]![0]);
    expect(output).toContain('[ERROR]');
    expect(output).toContain('critical failure');
  });

  it('suppresses warn when level is error', () => {
    logger.setLevel('error');
    logger.warn('this should be hidden');
    expect(console.error).toHaveBeenCalledTimes(0);
  });

  it('suppresses success logs when level is warn', () => {
    logger.setLevel('warn');
    logger.success('this should be hidden');
    expect(console.error).toHaveBeenCalledTimes(0);
  });

  describe('file logging', () => {
    let tempLogFile: string;

    beforeEach(async () => {
      tempLogFile = join(tmpdir(), `test-log-${Date.now()}.log`);
      vi.restoreAllMocks();
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(async () => {
      try {
        await fs.unlink(tempLogFile);
      } catch {
        // Ignore if file doesn't exist
      }
    });

    it('creates log file with secure permissions when filePath is provided', async () => {
      const fileLogger = new Logger({ level: 'info', filePath: tempLogFile });

      // Wait for file initialization
      await new Promise((resolve) => setTimeout(resolve, 100));

      fileLogger.info('test message');

      // Check file was created
      const stats = await fs.stat(tempLogFile);
      expect(stats.isFile()).toBe(true);

      // Check permissions (0600)
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);

      // Check content
      const content = await fs.readFile(tempLogFile, 'utf-8');
      expect(content).toContain('test message');
      expect(content).toContain('[INFO]');

      fileLogger.close();
    });

    it('logs to both console and file', async () => {
      const fileLogger = new Logger({ level: 'info', filePath: tempLogFile });

      // Wait for file initialization
      await new Promise((resolve) => setTimeout(resolve, 100));

      fileLogger.info('dual output test');

      expect(console.error).toHaveBeenCalledTimes(1);
      const consoleOutput = String((console.error as any).mock.calls[0]![0]);
      expect(consoleOutput).toContain('dual output test');

      const fileContent = await fs.readFile(tempLogFile, 'utf-8');
      expect(fileContent).toContain('dual output test');

      fileLogger.close();
    });
  });
});
