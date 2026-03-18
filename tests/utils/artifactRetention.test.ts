import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
});
