import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Regression tests for artifactRetention races:
 * 1. getManagedArtifactDirectories returned the artifacts root AND every
 *    category subdirectory — walkAndProcess recurses, so every artifact file
 *    was scanned/removed twice (inflated counters, wrong size trimming).
 * 2. Removal scheduled from scan-time stats could delete a file a concurrent
 *    writer had just updated (rm after the scan). Fix: re-stat before the
 *    destructive rm and skip when the file changed.
 * 3. pruneEmptyDirectories deleted managed root directories (the mkdir
 *    targets of resolveArtifactPath), racing concurrent writers into ENOENT.
 */
describe('artifactRetention races', () => {
  let root: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'jshook-artrace-'));
    // Keep cwd-derived directories inside the temp root so no real repo
    // directories leak into the scan.
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(root);
  });

  afterEach(async () => {
    // The concurrent-writer test doMocks node:fs/promises — persist the
    // restore so later tests re-import the real implementation.
    vi.doUnmock('node:fs/promises');
    vi.resetModules();
    cwdSpy.mockRestore();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  async function setupSpies(projectRoot: string) {
    const artifacts = await import('@utils/artifacts');
    const outputPaths = await import('@utils/outputPaths');
    vi.spyOn(outputPaths, 'getProjectRoot').mockReturnValue(projectRoot);
    vi.spyOn(artifacts, 'getArtifactsRoot').mockReturnValue(join(projectRoot, 'artifacts'));
    vi.spyOn(artifacts, 'getArtifactDir').mockImplementation((category) =>
      join(projectRoot, 'artifacts', category),
    );
    return { artifacts, outputPaths };
  }

  it('scans each artifact file exactly once with default directories', async () => {
    const wasmDir = join(root, 'artifacts', 'wasm');
    await mkdir(wasmDir, { recursive: true });
    const file = join(wasmDir, 'old.bin');
    await writeFile(file, 'data');
    const oldTime = new Date('2024-01-01T00:00:00.000Z');
    await utimes(file, oldTime, oldTime);

    // Isolate from real screenshot/debugger-sessions directories.
    process.env.MCP_SCREENSHOT_DIR = join(root, 'screenshots');
    process.env.MCP_DEBUGGER_SESSIONS_DIR = join(root, 'debugger-sessions');
    await setupSpies(root);

    const { cleanupArtifacts } = await import('@utils/artifactRetention');
    const result = await cleanupArtifacts({
      retentionDays: 1,
      now: new Date('2024-01-10T00:00:00.000Z').getTime(),
    });

    // Pre-fix: artifacts/ was walked, then artifacts/wasm again → 2.
    expect(result.scannedFiles).toBe(1);
    expect(result.removedFiles).toBe(1);
    await expect(stat(file)).rejects.toThrow();
  });

  it('does not delete a file updated after the scan (concurrent writer)', async () => {
    vi.resetModules();

    const oldMtime = new Date('2024-01-01T00:00:00.000Z').getTime();
    const newMtime = Date.now();

    const readdir = vi.fn(async () => [
      { name: 'old.txt', isFile: () => true, isDirectory: () => false },
    ]);
    let statCalls = 0;
    const statMock = vi.fn(async () => {
      statCalls++;
      return statCalls === 1 ? { size: 10, mtimeMs: oldMtime } : { size: 10, mtimeMs: newMtime };
    });
    const rmMock = vi.fn(async () => undefined);

    vi.doMock('node:fs/promises', async (importOriginal) => ({
      ...(await importOriginal<typeof import('node:fs/promises')>()),
      readdir,
      stat: statMock,
      rm: rmMock,
    }));

    const wasmDir = join(root, 'artifacts', 'wasm');
    await mkdir(wasmDir, { recursive: true });
    await setupSpies(root);

    const { cleanupArtifacts } = await import('@utils/artifactRetention');
    const result = await cleanupArtifacts({
      categories: ['wasm'],
      retentionDays: 1,
      now: newMtime + 10 * DAY_MS,
    });

    // The post-check re-stat saw a fresher mtime and vetoed the rm, so the
    // file was NOT removed — counters reflect the actual outcome, not the
    // scan-time candidate.
    expect(result.removedFiles).toBe(0);
    expect(rmMock).not.toHaveBeenCalled();
    // Second stat call is the post-check re-stat.
    expect(statCalls).toBe(2);
  });

  it('does not delete a file whose size changed after the scan (mtime unchanged)', async () => {
    vi.resetModules();

    const mtime = new Date('2024-01-01T00:00:00.000Z').getTime();

    const readdir = vi.fn(async () => [
      { name: 'grew.txt', isFile: () => true, isDirectory: () => false },
    ]);
    let statCalls = 0;
    const statMock = vi.fn(async () => {
      statCalls++;
      // Scan-time snapshot vs post-check: same mtime tick, larger size —
      // mtime-only checks would miss this concurrent write.
      return statCalls === 1 ? { size: 10, mtimeMs: mtime } : { size: 2048, mtimeMs: mtime };
    });
    const rmMock = vi.fn(async () => undefined);

    vi.doMock('node:fs/promises', async (importOriginal) => ({
      ...(await importOriginal<typeof import('node:fs/promises')>()),
      readdir,
      stat: statMock,
      rm: rmMock,
    }));

    const wasmDir = join(root, 'artifacts', 'wasm');
    await mkdir(wasmDir, { recursive: true });
    await setupSpies(root);

    const { cleanupArtifacts } = await import('@utils/artifactRetention');
    const result = await cleanupArtifacts({
      categories: ['wasm'],
      retentionDays: 1,
      now: mtime + 10 * DAY_MS,
    });

    expect(result.removedFiles).toBe(0);
    // The vetoed candidate survived, so it is still on disk and must be
    // reported as remaining (and as a failed removal) rather than silently
    // dropped from the accounting.
    expect(result.failedRemovals).toBe(1);
    expect(result.remainingFiles).toBe(1);
    expect(rmMock).not.toHaveBeenCalled();
  });

  it('prune does not delete a directory that gained a file after the emptiness check', async () => {
    vi.resetModules();

    const wasmDir = join(root, 'artifacts', 'wasm');
    const nested = join(wasmDir, 'grew');

    // readdir returns [] for the emptiness re-check even though a file exists
    // on disk — the pre-rm window the old rm(recursive) would lose data in.
    // Only the top-level walk reports the subdirectory; deeper levels report
    // nothing so the walk terminates.
    const readdirMock = vi.fn(async (dir: string, options?: { withFileTypes?: boolean }) => {
      if (options?.withFileTypes) {
        return dir === wasmDir
          ? [{ name: 'grew', isFile: () => false, isDirectory: () => true }]
          : [];
      }
      return [];
    });

    vi.doMock('node:fs/promises', async (importOriginal) => ({
      ...(await importOriginal<typeof import('node:fs/promises')>()),
      readdir: readdirMock,
    }));

    await setupSpies(root);

    await mkdir(nested, { recursive: true });
    const freshFile = join(nested, 'fresh.txt');
    await writeFile(freshFile, 'fresh data');

    const { cleanupArtifacts } = await import('@utils/artifactRetention');
    const result = await cleanupArtifacts({ categories: ['wasm'] });

    expect(result.success).toBe(true);
    // rmdir refuses to remove the non-empty directory — the fresh file must
    // survive even though the emptiness re-check lied.
    await expect(stat(freshFile)).resolves.toBeDefined();
    await expect(stat(nested)).resolves.toBeDefined();
  });

  it('keeps managed category root dirs but prunes empty nested dirs', async () => {
    const wasmDir = join(root, 'artifacts', 'wasm');
    const nested = join(wasmDir, 'sub');
    await mkdir(nested, { recursive: true });
    await setupSpies(root);

    const { cleanupArtifacts } = await import('@utils/artifactRetention');
    const result = await cleanupArtifacts({ categories: ['wasm'] });

    expect(result.success).toBe(true);
    // The mkdir target of resolveArtifactPath must survive cleanup.
    await expect(stat(wasmDir)).resolves.toBeDefined();
    // Deeply nested empty dirs are still pruned.
    await expect(stat(nested)).rejects.toThrow();
  });
});
