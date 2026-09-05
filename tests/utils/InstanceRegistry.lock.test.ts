import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('utils/InstanceRegistry registration lock', () => {
  let stateDir: string;

  beforeEach(async () => {
    vi.resetModules();
    stateDir = await mkdtemp(join(tmpdir(), 'jshook-state-'));
    process.env.JSHOOK_STATE_DIR = stateDir;
  });

  afterEach(async () => {
    delete process.env.JSHOOK_STATE_DIR;
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
    await rm(stateDir, { recursive: true, force: true });
  });

  const lockDir = () => join(stateDir, 'instances', '.register-lock');

  it('serializes concurrent registrations — every writer lands', async () => {
    vi.doMock('@src/constants', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@src/constants')>()),
      JSHOOK_INSTANCE_WARN_AT: 99,
      JSHOOK_MAX_INSTANCES: 0,
    }));
    const { registerServerInstance } = await import('@utils/InstanceRegistry');

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        registerServerInstance({ transport: `stdio-${i}`, profile: 'workflow' }),
      ),
    );

    expect(results).toHaveLength(5);
    results.forEach((r) => {
      expect(r.blocked).toBe(false);
      expect(r.self.pid).toBe(process.pid);
    });
    // Records are keyed by pid: the concurrent writers converge on one
    // consistent record instead of interleaving partial writes.
    const records = await readdir(join(stateDir, 'instances'));
    const jsonRecords = records.filter((f) => f.endsWith('.json'));
    expect(jsonRecords).toEqual([`${process.pid}.json`]);
  });

  it('takes over a stale lock atomically and registers', async () => {
    vi.doMock('@src/constants', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@src/constants')>()),
      JSHOOK_INSTANCE_WARN_AT: 99,
      JSHOOK_MAX_INSTANCES: 0,
    }));
    const { registerServerInstance } = await import('@utils/InstanceRegistry');

    await mkdir(join(stateDir, 'instances'), { recursive: true });
    await mkdir(lockDir());
    // Backdate beyond the 30s staleness window.
    const stale = new Date(Date.now() - 60_000);
    utimesSync(lockDir(), stale, stale);

    const result = await registerServerInstance({ transport: 'stdio', profile: 'workflow' });
    expect(result.self.pid).toBe(process.pid);
    // The stale lock must be gone (renamed away + removed).
    const entries = await readdir(join(stateDir, 'instances'));
    expect(entries.some((f) => f.startsWith('.register-lock'))).toBe(false);
  });

  it('two waiters racing on a stale lock cannot double-own or lose the lock', async () => {
    vi.doMock('@src/constants', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@src/constants')>()),
      JSHOOK_INSTANCE_WARN_AT: 99,
      JSHOOK_MAX_INSTANCES: 0,
    }));
    const { registerServerInstance } = await import('@utils/InstanceRegistry');

    await mkdir(join(stateDir, 'instances'), { recursive: true });
    await mkdir(lockDir());
    const stale = new Date(Date.now() - 60_000);
    utimesSync(lockDir(), stale, stale);

    const results = await Promise.all([
      registerServerInstance({ transport: 'stdio-a', profile: 'workflow' }),
      registerServerInstance({ transport: 'stdio-b', profile: 'workflow' }),
    ]);

    // Both must complete through the lock (not the warn-only fallback —
    // neither saw the 5s deadline because the takeover unblocked them).
    // Records are keyed by pid, so two same-process registrations converge
    // on one record file.
    const records = await readdir(join(stateDir, 'instances'));
    const jsonRecords = records.filter((f) => f.endsWith('.json'));
    expect(jsonRecords).toEqual([`${process.pid}.json`]);
    expect(results).toHaveLength(2);
  });

  it('degrades to warn-only (runs unlocked) when the lock deadline expires', async () => {
    vi.doMock('@src/constants', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@src/constants')>()),
      JSHOOK_INSTANCE_WARN_AT: 99,
      JSHOOK_MAX_INSTANCES: 0,
    }));
    // Shrink the acquire-wait ceiling instead of mocking the clock: the
    // registry also calls Date.now for record reaping, so clock games would
    // misfire the staleness branch.
    process.env.JSHOOK_REGISTRATION_LOCK_TIMEOUT_MS = '1';

    const { registerServerInstance } = await import('@utils/InstanceRegistry');
    // vi.resetModules() re-instantiates the logger module — spy on the same
    // instance the registry actually uses.
    const { logger } = await import('@utils/logger');
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    // A fresh (non-stale) lock held by a crashed holder.
    await mkdir(join(stateDir, 'instances'), { recursive: true });
    await mkdir(lockDir());

    const result = await registerServerInstance({ transport: 'stdio', profile: 'workflow' });

    expect(result.self.pid).toBe(process.pid);
    // Registration ran WITHOUT the lock: the held lock is untouched and the
    // degradation was announced.
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('registering without it'));
    const entries = await readdir(join(stateDir, 'instances'));
    expect(entries.some((f) => f === '.register-lock')).toBe(true);
  });
});
