import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('utils/InstanceRegistry', () => {
  let stateDir: string;

  beforeEach(async () => {
    vi.resetModules();
    stateDir = await mkdtemp(join(tmpdir(), 'jshook-state-'));
    process.env.JSHOOK_STATE_DIR = stateDir;
  });

  afterEach(async () => {
    delete process.env.JSHOOK_STATE_DIR;
    vi.unstubAllEnvs();
    await rm(stateDir, { recursive: true, force: true });
  });

  it('registers self and reports zero live peers', async () => {
    vi.doMock('@src/constants', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@src/constants')>();
      return {
        ...actual,
        JSHOOK_INSTANCE_WARN_AT: 99,
        JSHOOK_MAX_INSTANCES: 0,
      };
    });

    const { registerServerInstance, unregisterServerInstance, listLiveInstances } =
      await import('@utils/InstanceRegistry');

    const result = await registerServerInstance({ transport: 'stdio', profile: 'search' });
    expect(result.self.pid).toBe(process.pid);
    expect(result.liveCount).toBe(1);
    expect(result.livePeers).toEqual([]);
    expect(result.warned).toBe(false);
    expect(await listLiveInstances(process.pid)).toEqual([]);

    await unregisterServerInstance(process.pid);
  });

  it('warns when peer count reaches the threshold', async () => {
    vi.doMock('@src/constants', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@src/constants')>();
      return {
        ...actual,
        JSHOOK_INSTANCE_WARN_AT: 1,
        JSHOOK_MAX_INSTANCES: 0,
      };
    });

    const { registerServerInstance, unregisterServerInstance } =
      await import('@utils/InstanceRegistry');

    const result = await registerServerInstance({ transport: 'stdio', profile: 'search' });
    expect(result.warned).toBe(true);
    expect(result.liveCount).toBe(1);

    await unregisterServerInstance(process.pid);
  });

  it('reaps stale instance files for dead PIDs', async () => {
    vi.doMock('@src/constants', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@src/constants')>();
      return {
        ...actual,
        JSHOOK_INSTANCE_WARN_AT: 99,
        JSHOOK_MAX_INSTANCES: 0,
      };
    });

    const { getStateDir } = await import('@server/persistence/RuntimeSnapshotScheduler');
    const dir = join(getStateDir(), 'instances');
    await mkdir(dir, { recursive: true });
    const deadPid = 2_147_483_646;
    await writeFile(
      join(dir, `${deadPid}.json`),
      JSON.stringify({
        pid: deadPid,
        ppid: 1,
        startedAt: new Date().toISOString(),
        transport: 'stdio',
        profile: 'search',
        argv0: 'dead',
      }),
      'utf8',
    );

    const { listLiveInstances } = await import('@utils/InstanceRegistry');
    const live = await listLiveInstances(process.pid);
    expect(live.find((r) => r.pid === deadPid)).toBeUndefined();
  });

  it('blocks startup when JSHOOK_MAX_INSTANCES is exceeded', async () => {
    vi.doMock('@src/constants', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@src/constants')>();
      return {
        ...actual,
        JSHOOK_INSTANCE_WARN_AT: 99,
        JSHOOK_MAX_INSTANCES: 1,
      };
    });

    const { getStateDir } = await import('@server/persistence/RuntimeSnapshotScheduler');
    const dir = join(getStateDir(), 'instances');
    await mkdir(dir, { recursive: true });
    const peerPid = process.ppid;
    await writeFile(
      join(dir, `${peerPid}.json`),
      JSON.stringify({
        pid: peerPid,
        ppid: 1,
        startedAt: new Date().toISOString(),
        transport: 'stdio',
        profile: 'full',
        argv0: 'peer',
      }),
      'utf8',
    );

    const { registerServerInstance } = await import('@utils/InstanceRegistry');
    await expect(registerServerInstance({ transport: 'stdio', profile: 'search' })).rejects.toThrow(
      /instance limit reached/,
    );
  });
});
