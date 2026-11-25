import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('@utils/artifacts', () => ({
  getArtifactsRoot: () => '/mocked/artifacts',
  getArtifactDir: (category: string) => `/mocked/artifacts/${category}`,
}));

vi.mock('@utils/outputPaths', async () => {
  const { tmpdir: mockTmpdir } = await import('node:os');
  return {
    getProjectRoot: () => '/mocked/project',
    resolveOutputDirectory: (_dir: string | undefined, fallback: string) => `/mocked/${fallback}`,
    // Caller-supplied cleanup directories are now constrained to the safe
    // output roots; the tests pass temp dirs, so expose the system temp root.
    getSafeOutputRoots: () => [mockTmpdir()],
  };
});

import {
  cleanupArtifacts,
  getArtifactRetentionConfig,
  startArtifactRetentionScheduler,
} from '@utils/artifactRetention';

describe('ArtifactRetention – additional coverage', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'jshook-ret-'));
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe('startArtifactRetentionScheduler (lines 135-155)', () => {
    it('returns null when retention is not enabled', () => {
      const originalRetention = process.env.MCP_ARTIFACT_RETENTION_DAYS;
      const originalMax = process.env.MCP_ARTIFACT_MAX_TOTAL_MB;
      const originalInterval = process.env.MCP_ARTIFACT_CLEANUP_INTERVAL_MINUTES;

      process.env.MCP_ARTIFACT_RETENTION_DAYS = '0';
      process.env.MCP_ARTIFACT_MAX_TOTAL_MB = '0';
      process.env.MCP_ARTIFACT_CLEANUP_INTERVAL_MINUTES = '0';

      const result = startArtifactRetentionScheduler();
      expect(result).toBeNull();

      process.env.MCP_ARTIFACT_RETENTION_DAYS = originalRetention;
      process.env.MCP_ARTIFACT_MAX_TOTAL_MB = originalMax;
      process.env.MCP_ARTIFACT_CLEANUP_INTERVAL_MINUTES = originalInterval;
    });

    it('returns null when enabled but interval is 0', () => {
      const originalRetention = process.env.MCP_ARTIFACT_RETENTION_DAYS;
      const originalInterval = process.env.MCP_ARTIFACT_CLEANUP_INTERVAL_MINUTES;

      process.env.MCP_ARTIFACT_RETENTION_DAYS = '7';
      process.env.MCP_ARTIFACT_CLEANUP_INTERVAL_MINUTES = '0';

      const result = startArtifactRetentionScheduler();
      expect(result).toBeNull();

      process.env.MCP_ARTIFACT_RETENTION_DAYS = originalRetention;
      process.env.MCP_ARTIFACT_CLEANUP_INTERVAL_MINUTES = originalInterval;
    });

    it('returns a cancel function when properly configured', () => {
      const originalRetention = process.env.MCP_ARTIFACT_RETENTION_DAYS;
      const originalInterval = process.env.MCP_ARTIFACT_CLEANUP_INTERVAL_MINUTES;

      process.env.MCP_ARTIFACT_RETENTION_DAYS = '7';
      process.env.MCP_ARTIFACT_CLEANUP_INTERVAL_MINUTES = '60';

      const cancel = startArtifactRetentionScheduler();
      expect(typeof cancel).toBe('function');

      // Clean up the interval
      if (cancel) cancel();

      process.env.MCP_ARTIFACT_RETENTION_DAYS = originalRetention;
      process.env.MCP_ARTIFACT_CLEANUP_INTERVAL_MINUTES = originalInterval;
    });

    it('is idempotent — a second start returns the same stop handle and one timer', () => {
      const originalRetention = process.env.MCP_ARTIFACT_RETENTION_DAYS;
      const originalInterval = process.env.MCP_ARTIFACT_CLEANUP_INTERVAL_MINUTES;
      process.env.MCP_ARTIFACT_RETENTION_DAYS = '7';
      process.env.MCP_ARTIFACT_CLEANUP_INTERVAL_MINUTES = '60';

      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      try {
        // Server startup wires the scheduler in MCPServer.start() AND the CLI
        // entry (index.ts) calls it — both must share one timer instead of
        // stacking intervals (architecture hygiene, 2026-08-18).
        const first = startArtifactRetentionScheduler();
        const second = startArtifactRetentionScheduler();
        expect(typeof first).toBe('function');
        expect(second).toBe(first);
        expect(setIntervalSpy).toHaveBeenCalledTimes(1);
        // Stopping re-arms the singleton so a restarted server can start again.
        first?.();
        const third = startArtifactRetentionScheduler();
        expect(typeof third).toBe('function');
        expect(third).not.toBe(first);
        expect(setIntervalSpy).toHaveBeenCalledTimes(2);
        third?.();
      } finally {
        setIntervalSpy.mockRestore();
        process.env.MCP_ARTIFACT_RETENTION_DAYS = originalRetention;
        process.env.MCP_ARTIFACT_CLEANUP_INTERVAL_MINUTES = originalInterval;
      }
    });
  });

  describe('getArtifactRetentionConfig', () => {
    it('parses environment variables correctly', () => {
      const config = getArtifactRetentionConfig({
        MCP_ARTIFACT_RETENTION_DAYS: '14',
        MCP_ARTIFACT_MAX_TOTAL_MB: '512',
        MCP_ARTIFACT_CLEANUP_INTERVAL_MINUTES: '30',
        MCP_ARTIFACT_CLEANUP_ON_START: 'true',
      } as unknown as NodeJS.ProcessEnv);

      expect(config.enabled).toBe(true);
      expect(config.retentionDays).toBe(14);
      expect(config.maxTotalBytes).toBe(512 * 1024 * 1024);
      expect(config.cleanupIntervalMinutes).toBe(30);
      expect(config.cleanupOnStart).toBe(true);
    });

    it('returns disabled config for empty/zero values', () => {
      const config = getArtifactRetentionConfig({
        MCP_ARTIFACT_RETENTION_DAYS: '0',
        MCP_ARTIFACT_MAX_TOTAL_MB: '0',
        MCP_ARTIFACT_CLEANUP_INTERVAL_MINUTES: '0',
      } as unknown as NodeJS.ProcessEnv);

      expect(config.enabled).toBe(false);
      expect(config.retentionDays).toBe(0);
      expect(config.maxTotalBytes).toBe(0);
    });

    it('falls back instead of partially parsing malformed numeric values', () => {
      const config = getArtifactRetentionConfig({
        MCP_ARTIFACT_RETENTION_DAYS: '14days',
        MCP_ARTIFACT_MAX_TOTAL_MB: '1.5',
        MCP_ARTIFACT_CLEANUP_INTERVAL_MINUTES: '30minutes',
      } as unknown as NodeJS.ProcessEnv);

      expect(config.retentionDays).toBe(7);
      expect(config.maxTotalBytes).toBe(0);
      expect(config.cleanupIntervalMinutes).toBe(360);
    });

    it('applies safe defaults when no env vars are set (a4-06)', () => {
      // 2026-08-18: retention used to default to disabled (env ?? '0'), letting
      // artifacts accumulate until the disk filled (a4-06). The new defaults
      // keep a 7-day age window and a 6-hourly sweep; explicit env zeros above
      // still disable it.
      const config = getArtifactRetentionConfig({} as unknown as NodeJS.ProcessEnv);

      expect(config.enabled).toBe(true);
      expect(config.retentionDays).toBe(7);
      expect(config.maxTotalBytes).toBe(0);
      expect(config.cleanupIntervalMinutes).toBe(360);
      expect(config.cleanupOnStart).toBe(false);
    });

    it('schedules by default and returns a cancel function (a4-06)', () => {
      const originalRetention = process.env.MCP_ARTIFACT_RETENTION_DAYS;
      const originalMax = process.env.MCP_ARTIFACT_MAX_TOTAL_MB;
      const originalInterval = process.env.MCP_ARTIFACT_CLEANUP_INTERVAL_MINUTES;
      delete process.env.MCP_ARTIFACT_RETENTION_DAYS;
      delete process.env.MCP_ARTIFACT_MAX_TOTAL_MB;
      delete process.env.MCP_ARTIFACT_CLEANUP_INTERVAL_MINUTES;

      try {
        const cancel = startArtifactRetentionScheduler();
        expect(typeof cancel).toBe('function');
        if (cancel) cancel();
      } finally {
        if (originalRetention === undefined) {
          delete process.env.MCP_ARTIFACT_RETENTION_DAYS;
        } else {
          process.env.MCP_ARTIFACT_RETENTION_DAYS = originalRetention;
        }
        if (originalMax === undefined) {
          delete process.env.MCP_ARTIFACT_MAX_TOTAL_MB;
        } else {
          process.env.MCP_ARTIFACT_MAX_TOTAL_MB = originalMax;
        }
        if (originalInterval === undefined) {
          delete process.env.MCP_ARTIFACT_CLEANUP_INTERVAL_MINUTES;
        } else {
          process.env.MCP_ARTIFACT_CLEANUP_INTERVAL_MINUTES = originalInterval;
        }
      }
    });

    it('handles cleanupOnStart with value "1"', () => {
      const config = getArtifactRetentionConfig({
        MCP_ARTIFACT_CLEANUP_ON_START: '1',
      } as unknown as NodeJS.ProcessEnv);

      expect(config.cleanupOnStart).toBe(true);
    });
  });

  describe('cleanupArtifacts – empty directories (lines 174-192)', () => {
    it('handles empty directories without errors', async () => {
      const emptyDir = join(root, 'empty');
      await mkdir(emptyDir, { recursive: true });

      const result = await cleanupArtifacts({
        retentionDays: 1,
        dryRun: false,
        directories: [emptyDir],
      });

      expect(result.success).toBe(true);
      expect(result.scannedFiles).toBe(0);
      expect(result.removedFiles).toBe(0);
    });

    it('handles non-existent directories without errors', async () => {
      const result = await cleanupArtifacts({
        retentionDays: 1,
        dryRun: false,
        directories: [join(root, 'does-not-exist')],
      });

      expect(result.success).toBe(true);
      expect(result.scannedFiles).toBe(0);
    });
  });

  describe('cleanupArtifacts – dry run (line 199)', () => {
    it('reports files that would be removed without actually removing them', async () => {
      const dir = join(root, 'dryrun');
      await mkdir(dir, { recursive: true });
      const oldFile = join(dir, 'old.json');
      await writeFile(oldFile, 'test-data');
      const oldTime = new Date('2024-01-01T00:00:00.000Z');
      const { utimes } = await import('node:fs/promises');
      await utimes(oldFile, oldTime, oldTime);

      const result = await cleanupArtifacts({
        retentionDays: 1,
        dryRun: true,
        now: new Date('2024-06-01T00:00:00.000Z').getTime(),
        directories: [dir],
      });

      expect(result.removedFiles).toBe(1);
      expect(result.dryRun).toBe(true);
      // File should still exist
      const { stat } = await import('node:fs/promises');
      await expect(stat(oldFile)).resolves.toBeDefined();
    });
  });

  describe('cleanupArtifacts – pruneEmptyDirectories (lines 212-234)', () => {
    it('prunes empty subdirectories after removing files', async () => {
      const subDir = join(root, 'prunetest', 'sub', 'deep');
      await mkdir(subDir, { recursive: true });
      const file = join(subDir, 'old.txt');
      await writeFile(file, 'data');
      const oldTime = new Date('2024-01-01T00:00:00.000Z');
      const { utimes } = await import('node:fs/promises');
      await utimes(file, oldTime, oldTime);

      await cleanupArtifacts({
        retentionDays: 1,
        dryRun: false,
        now: new Date('2024-06-01T00:00:00.000Z').getTime(),
        directories: [join(root, 'prunetest')],
      });

      // The empty subdirectory chain should be pruned
      const { stat } = await import('node:fs/promises');
      await expect(stat(subDir)).rejects.toThrow();
    });
  });

  describe('cleanupArtifacts – combined age + size limits', () => {
    it('applies both retention days and size cap', async () => {
      const dir = join(root, 'combined');
      await mkdir(dir, { recursive: true });

      // Create old file (will be removed by age)
      const oldFile = join(dir, 'old.dat');
      await writeFile(oldFile, 'old-content');
      const oldTime = new Date('2024-01-01T00:00:00.000Z');

      // Create newer but large files
      const newFile1 = join(dir, 'new1.dat');
      const newFile2 = join(dir, 'new2.dat');
      await writeFile(newFile1, 'A'.repeat(1000));
      await writeFile(newFile2, 'B'.repeat(1000));
      const newTime = new Date('2024-06-01T00:00:00.000Z');

      const { utimes } = await import('node:fs/promises');
      await utimes(oldFile, oldTime, oldTime);
      await utimes(newFile1, newTime, newTime);
      await utimes(newFile2, newTime, newTime);

      const result = await cleanupArtifacts({
        retentionDays: 30,
        maxTotalBytes: 500,
        dryRun: false,
        now: new Date('2024-06-15T00:00:00.000Z').getTime(),
        directories: [dir],
      });

      expect(result.removedFiles).toBeGreaterThanOrEqual(1);
      expect(result.success).toBe(true);
    });
  });

  describe('cleanupArtifacts – removedSample limit', () => {
    it('caps removedSample at 20 entries', async () => {
      const dir = join(root, 'many-files');
      await mkdir(dir, { recursive: true });
      const oldTime = new Date('2024-01-01T00:00:00.000Z');
      const { utimes } = await import('node:fs/promises');

      for (let i = 0; i < 25; i++) {
        const f = join(dir, `file${i}.tmp`);
        await writeFile(f, `content-${i}`);
        await utimes(f, oldTime, oldTime);
      }

      const result = await cleanupArtifacts({
        retentionDays: 1,
        dryRun: true,
        now: new Date('2024-06-01T00:00:00.000Z').getTime(),
        directories: [dir],
      });

      expect(result.removedSample.length).toBeLessThanOrEqual(20);
      expect(result.removedFiles).toBe(25);
    });
  });
});
