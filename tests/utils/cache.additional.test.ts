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
    dir: '/tmp/jshookcp-cache-test',
    ttl: 1,
    ...overrides,
  };
}

describe('CacheManager – additional coverage', () => {
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

  describe('init – disabled cache', () => {
    it('skips directory creation when disabled', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const mkdirSpy = vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
      const manager = new CacheManager(createConfig({ enabled: false }));

      await manager.init();

      expect(mkdirSpy).not.toHaveBeenCalled();
    });
  });

  describe('init – mkdir failure', () => {
    it('logs error when mkdir fails', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      vi.spyOn(fs, 'mkdir').mockRejectedValue(new Error('permission denied'));
      const manager = new CacheManager(createConfig());

      await manager.init();

      expect(loggerState.error).toHaveBeenCalledWith(
        'Failed to initialize cache directory',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        expect.any(Error),
      );
    });
  });

  describe('get – cache miss (lines 71-80)', () => {
    it('returns null and logs cache miss on read error', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      vi.spyOn(fs, 'readFile').mockRejectedValue(
        Object.assign(new Error('no such file'), { code: 'ENOENT' }),
      );
      const manager = new CacheManager(createConfig());

      const result = await manager.get('missing-key');

      expect(result).toBeNull();
      expect(loggerState.debug).toHaveBeenCalledWith('Cache miss: missing-key');
    });

    it('returns null on JSON parse error', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      vi.spyOn(fs, 'readFile').mockResolvedValue('not valid json{{{');
      const manager = new CacheManager(createConfig());

      const result = await manager.get('bad-json');

      expect(result).toBeNull();
      expect(loggerState.debug).toHaveBeenCalledWith('Cache miss: bad-json');
    });
  });

  describe('set – disabled cache', () => {
    it('skips write when disabled', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const writeSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);
      const manager = new CacheManager(createConfig({ enabled: false }));

      await manager.set('key', 'value');

      expect(writeSpy).not.toHaveBeenCalled();
    });
  });

  describe('set – write failure (lines 72-74)', () => {
    it('logs error when write fails', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      vi.spyOn(fs, 'writeFile').mockRejectedValue(new Error('disk full'));
      const manager = new CacheManager(createConfig());

      await manager.set('key', { data: 'value' });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(loggerState.error).toHaveBeenCalledWith('Failed to set cache', expect.any(Error));
    });
  });

  describe('delete – disabled cache', () => {
    it('skips delete when disabled', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const unlinkSpy = vi.spyOn(fs, 'unlink').mockResolvedValue(undefined);
      const manager = new CacheManager(createConfig({ enabled: false }));

      await manager.delete('key');

      expect(unlinkSpy).not.toHaveBeenCalled();
    });
  });

  describe('clear – disabled cache', () => {
    it('skips clear when disabled', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const readdirSpy = vi.spyOn(fs, 'readdir').mockResolvedValue([] as any);
      const manager = new CacheManager(createConfig({ enabled: false }));

      await manager.clear();

      expect(readdirSpy).not.toHaveBeenCalled();
    });
  });

  describe('clear – non-ENOENT error (lines 102-106)', () => {
    it('logs error for non-ENOENT readdir failures', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      vi.spyOn(fs, 'readdir').mockRejectedValue(
        Object.assign(new Error('permission denied'), { code: 'EACCES' }),
      );
      const manager = new CacheManager(createConfig());

      await manager.clear();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(loggerState.error).toHaveBeenCalledWith('Failed to clear cache', expect.any(Error));
    });
  });

  describe('TTL expiry', () => {
    it('returns cached value when within TTL', async () => {
      const now = Date.now();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      vi.spyOn(fs, 'readFile').mockResolvedValue(
        JSON.stringify({ timestamp: now - 500, value: { fresh: true } }),
      );
      const manager = new CacheManager(createConfig({ ttl: 10 }));

      const result = await manager.get<{ fresh: boolean }>('within-ttl');
      expect(result).toEqual({ fresh: true });
    });

    it('returns null and deletes when past TTL', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      vi.spyOn(fs, 'readFile').mockResolvedValue(
        JSON.stringify({ timestamp: Date.now() - 60_000, value: { stale: true } }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const unlinkSpy = vi.spyOn(fs, 'unlink').mockResolvedValue(undefined);
      const manager = new CacheManager(createConfig({ ttl: 5 }));

      const result = await manager.get('past-ttl');
      expect(result).toBeNull();
      expect(unlinkSpy).toHaveBeenCalled();
    });
  });

  describe('key hashing', () => {
    it('uses consistent hashing for the same key', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const writeSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);
      const manager = new CacheManager(createConfig());

      await manager.set('test-key-123', 'value1');
      await manager.set('test-key-123', 'value2');

      // Both writes should use the same cache path
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const path1 = writeSpy.mock.calls[0]?.[0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const path2 = writeSpy.mock.calls[1]?.[0];
      expect(path1).toBe(path2);
    });

    it('uses different paths for different keys', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const writeSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);
      const manager = new CacheManager(createConfig());

      await manager.set('key-A', 'value1');
      await manager.set('key-B', 'value2');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const path1 = writeSpy.mock.calls[0]?.[0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const path2 = writeSpy.mock.calls[1]?.[0];
      expect(path1).not.toBe(path2);
    });
  });
});
