import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../src/utils/logger.js';

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
});
