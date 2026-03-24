import { promises as fs } from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/utils/logger', () => ({
  logger: loggerState,
}));

import { CacheManager } from '@utils/cache';

function createConfig(overrides?: Partial<{ enabled: boolean; dir: string; ttl: number }>) {
  return {
    enabled: true,
    dir: '/tmp/jshookcp-cache',
    ttl: 1,
    ...overrides,
  };
}

describe('CacheManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    loggerState.debug.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    loggerState.info.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    loggerState.warn.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    loggerState.error.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes cache directory when enabled', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const mkdirSpy = vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
    const manager = new CacheManager(createConfig());

    await manager.init();

    expect(mkdirSpy).toHaveBeenCalledWith('/tmp/jshookcp-cache', { recursive: true });
    expect(loggerState.debug).toHaveBeenCalledWith(
      'Cache directory initialized: /tmp/jshookcp-cache',
    );
  });

  it('returns null immediately when cache is disabled', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const readSpy = vi.spyOn(fs, 'readFile').mockResolvedValue('{}');
    const manager = new CacheManager(createConfig({ enabled: false }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const result = await manager.get('any-key');

    expect(result).toBeNull();
    expect(readSpy).not.toHaveBeenCalled();
  });

  it('returns cached value when entry is fresh', async () => {
    const payload = { timestamp: Date.now(), value: { token: 'abc' } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    vi.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify(payload));
    const manager = new CacheManager(createConfig({ ttl: 60 }));

    const result = await manager.get<{ token: string }>('fresh-key');

    expect(result).toEqual({ token: 'abc' });
    expect(loggerState.debug).toHaveBeenCalledWith('Cache hit: fresh-key');
  });

  it('expires stale entries and removes cache file', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    vi.spyOn(fs, 'readFile').mockResolvedValue(
      JSON.stringify({ timestamp: Date.now() - 5_000, value: { old: true } }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const unlinkSpy = vi.spyOn(fs, 'unlink').mockResolvedValue(undefined);
    const manager = new CacheManager(createConfig({ ttl: 1 }));

    const result = await manager.get('stale-key');

    expect(result).toBeNull();
    expect(unlinkSpy).toHaveBeenCalledTimes(1);
  });

  it('persists structured data and timestamp on set', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const writeSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);
    const manager = new CacheManager(createConfig());

    await manager.set('store-key', { count: 7, nested: { ok: true } });

    expect(writeSpy).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const [, raw] = writeSpy.mock.calls[0]!;
    const parsed = JSON.parse(String(raw));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parsed.value).toEqual({ count: 7, nested: { ok: true } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(typeof parsed.timestamp).toBe('number');
  });

  it('ignores ENOENT during delete and warns on other unlink errors', async () => {
    const manager = new CacheManager(createConfig());
    const unlinkSpy = vi.spyOn(fs, 'unlink');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    unlinkSpy.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    await expect(manager.delete('missing-key')).resolves.toBeUndefined();
    expect(loggerState.warn).not.toHaveBeenCalled();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    unlinkSpy.mockRejectedValueOnce(
      Object.assign(new Error('permission denied'), { code: 'EACCES' }),
    );
    await expect(manager.delete('forbidden-key')).resolves.toBeUndefined();
    expect(loggerState.warn).toHaveBeenCalledTimes(1);
  });

  it('clears all cached files and tolerates missing cache directory', async () => {
    const manager = new CacheManager(createConfig());
    const readdirSpy = vi.spyOn(fs, 'readdir');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const unlinkSpy = vi.spyOn(fs, 'unlink').mockResolvedValue(undefined);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    readdirSpy.mockResolvedValueOnce(['a.json', 'b.json'] as any);
    await manager.clear();
    expect(unlinkSpy).toHaveBeenCalledTimes(2);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    readdirSpy.mockRejectedValueOnce(Object.assign(new Error('no dir'), { code: 'ENOENT' }));
    await expect(manager.clear()).resolves.toBeUndefined();
    expect(loggerState.error).not.toHaveBeenCalled();
  });
});
