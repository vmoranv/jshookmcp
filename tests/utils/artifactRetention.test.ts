import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupArtifacts } from '@utils/artifactRetention';

describe('artifactRetention', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'jshook-artifacts-'));
    await mkdir(join(root, 'artifacts', 'har'), { recursive: true });
    await mkdir(join(root, 'screenshots', 'manual'), { recursive: true });
    await mkdir(join(root, 'debugger-sessions'), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('removes files older than retention window', async () => {
    const oldFile = join(root, 'artifacts', 'har', 'old.har');
    await writeFile(oldFile, 'old');
    const oldTime = new Date('2024-01-01T00:00:00.000Z');
    await import('node:fs/promises').then(({ utimes }) => utimes(oldFile, oldTime, oldTime));

    const result = await cleanupArtifacts({
      retentionDays: 1,
      dryRun: false,
      now: new Date('2024-01-10T00:00:00.000Z').getTime(),
      directories: [
        join(root, 'artifacts'),
        join(root, 'screenshots'),
        join(root, 'debugger-sessions'),
      ],
    });

    expect(result.removedFiles).toBe(1);
    expect(result.removedByAge).toBeGreaterThan(0);
  });

  it('trims oldest files when size cap is exceeded', async () => {
    const older = join(root, 'screenshots', 'manual', 'older.png');
    const newer = join(root, 'screenshots', 'manual', 'newer.png');
    await writeFile(older, '1234567890');
    await writeFile(newer, 'abcdefghij');
    const oldTime = new Date('2024-01-01T00:00:00.000Z');
    const newTime = new Date('2024-01-02T00:00:00.000Z');
    const { utimes } = await import('node:fs/promises');
    await utimes(older, oldTime, oldTime);
    await utimes(newer, newTime, newTime);

    const result = await cleanupArtifacts({
      maxTotalBytes: 10,
      dryRun: false,
      directories: [
        join(root, 'artifacts'),
        join(root, 'screenshots'),
        join(root, 'debugger-sessions'),
      ],
    });

    expect(result.removedFiles).toBe(1);
    expect(result.removedBySize).toBeGreaterThan(0);
    expect(result.remainingBytes).toBeLessThanOrEqual(10);
  });

  it('tolerates filesystem access errors gracefully', async () => {
    // Attempting to scan non-existent or restricted paths should return gracefully
    const result = await cleanupArtifacts({
      directories: [join(root, 'non-existent-dir')],
    });
    expect(result.success).toBe(true);
    expect(result.scannedFiles).toBe(0);
  });

  it('computes default directories and runs safely in dry_run mode', async () => {
    const artifacts = await import('@utils/artifacts');
    const outputPaths = await import('@utils/outputPaths');

    vi.spyOn(outputPaths, 'getProjectRoot').mockReturnValue(root);
    vi.spyOn(artifacts, 'getArtifactsRoot').mockReturnValue(join(root, 'artifacts'));
    vi.spyOn(artifacts, 'getArtifactDir').mockImplementation((category) =>
      join(root, 'artifacts', category),
    );
    vi.spyOn(outputPaths, 'resolveOutputDirectory').mockImplementation(
      (inputDir, fallbackDir) => inputDir ?? join(root, fallbackDir ?? 'screenshots'),
    );

    const result = await cleanupArtifacts({
      directories: undefined,
      dryRun: true,
    });
    expect(result.success).toBe(true);
    expect(result.directories.length).toBeGreaterThan(0);
    expect(result.directories).toContain(join(root, 'artifacts'));
    expect(result.directories).toContain(join(root, 'screenshots'));
  });

  it('keeps pruning cwd debugger sessions when MCP_PROJECT_ROOT is overridden', async () => {
    const artifacts = await import('@utils/artifacts');
    const outputPaths = await import('@utils/outputPaths');
    const originalProjectRoot = process.env.MCP_PROJECT_ROOT;
    const cwdRoot = join(root, 'runtime-cwd');
    const projectRoot = join(root, 'project-root');
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(cwdRoot);

    try {
      process.env.MCP_PROJECT_ROOT = 'custom-root';
      vi.spyOn(outputPaths, 'getProjectRoot').mockReturnValue(projectRoot);
      vi.spyOn(artifacts, 'getArtifactsRoot').mockReturnValue(join(projectRoot, 'artifacts'));
      vi.spyOn(artifacts, 'getArtifactDir').mockImplementation((category) =>
        join(projectRoot, 'artifacts', category),
      );
      vi.spyOn(outputPaths, 'resolveOutputDirectory').mockImplementation(
        (inputDir, fallbackDir) => inputDir ?? join(projectRoot, fallbackDir ?? 'screenshots'),
      );

      const result = await cleanupArtifacts({
        directories: undefined,
        dryRun: true,
      });

      expect(result.directories).toContain(join(projectRoot, 'debugger-sessions'));
      expect(result.directories).toContain(join(cwdRoot, 'debugger-sessions'));
    } finally {
      cwdSpy.mockRestore();
      if (originalProjectRoot === undefined) {
        delete process.env.MCP_PROJECT_ROOT;
      } else {
        process.env.MCP_PROJECT_ROOT = originalProjectRoot;
      }
    }
  });
});

describe('artifactRetention Scheduler', () => {
  it('skips scheduling if interval is 0', async () => {
    const { startArtifactRetentionScheduler } = await import('@utils/artifactRetention');
    process.env.MCP_ARTIFACT_CLEANUP_INTERVAL_MINUTES = '0';
    const stopFn = startArtifactRetentionScheduler();
    expect(stopFn).toBeNull();
  });

  it('spawns and stops interval scheduling bounds correctly', async () => {
    const { startArtifactRetentionScheduler } = await import('@utils/artifactRetention');
    process.env.MCP_ARTIFACT_CLEANUP_INTERVAL_MINUTES = '1';
    const stopFn = startArtifactRetentionScheduler();
    expect(stopFn).toBeDefined();
    if (stopFn) {
      expect(() => stopFn()).not.toThrow();
    }
  });
});
