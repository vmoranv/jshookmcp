import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { CoreMaintenanceHandlers } from '@server/domains/maintenance/handlers';
import type { SnapshotManager } from '@utils/artifact-snapshot';

describe('CoreMaintenanceHandlers snapshot tools', () => {
  const tokenBudget = {
    getStats: vi.fn(),
    manualCleanup: vi.fn(),
    reset: vi.fn(),
  } as any;

  const unifiedCache = {
    getGlobalStats: vi.fn(),
    smartCleanup: vi.fn(),
    clearAll: vi.fn(),
  } as any;

  const artifactCleanup = vi.fn();
  const environmentDoctor = vi.fn();

  let targetDir: string;
  let fakeManager: SnapshotManager;
  let factoryCalls: Array<{ storeDir: string; workTree: string }>;
  let handlers: CoreMaintenanceHandlers;

  const snapshotManagerFactory = vi.fn((options: { storeDir: string; workTree: string }) => {
    factoryCalls.push(options);
    return fakeManager;
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    targetDir = await mkdtemp(join(tmpdir(), 'jshook-snapshot-target-'));
    factoryCalls = [];
    fakeManager = {
      ensureRepo: vi.fn(async () => undefined),
      snapshot: vi.fn(async (label?: string) => ({
        id: 'snap-test-1',
        treeHash: 'a'.repeat(40),
        ...(label !== undefined ? { label } : {}),
        timestamp: '2026-09-13T00:00:00.000Z',
      })),
      list: vi.fn(async () => [
        {
          id: 'snap-test-2',
          treeHash: 'b'.repeat(40),
          label: 'latest',
          timestamp: '2026-09-13T01:00:00.000Z',
        },
      ]),
      restore: vi.fn(async (snapshotId: string) => ({
        snapshotId,
        treeHash: 'c'.repeat(40),
        restoredFiles: 3,
        deletedFiles: 1,
        deletedSample: ['c.txt'],
      })),
      gc: vi.fn(async () => ({ removedSnapshots: 1, remainingSnapshots: 2, pruned: true })),
    };
    handlers = new CoreMaintenanceHandlers({
      tokenBudget,
      unifiedCache,
      artifactCleanup,
      environmentDoctor,
      snapshotManagerFactory,
    });
  });

  afterEach(async () => {
    await rm(targetDir, { recursive: true, force: true });
  });

  it('snapshot_create resolves a temp-dir target and returns the snapshot record', async () => {
    const body = parseJson<any>(
      await handlers.handleSnapshotCreate({ targetDir, label: '  pre-scan  ' }),
    );

    expect(body.success).toBe(true);
    expect(body.snapshotId).toBe('snap-test-1');
    expect(body.treeHash).toBe('a'.repeat(40));
    expect(body.label).toBe('pre-scan');
    expect(factoryCalls).toHaveLength(1);
    // Store lives outside the target; work tree is the normalized target.
    expect(factoryCalls[0]?.workTree).not.toBe(factoryCalls[0]?.storeDir);
    expect(factoryCalls[0]?.workTree.toLowerCase()).toBe(targetDir.toLowerCase());
  });

  it('snapshot_create rejects target dirs outside the allowed roots', async () => {
    const body = parseJson<any>(
      await handlers.handleSnapshotCreate({ targetDir: join(targetDir, '..', '..', 'escape') }),
    );

    expect(body.success).toBe(false);
    expect(body.error).toMatch(/project root or system temp directories/);
    expect(factoryCalls).toHaveLength(0);
  });

  it('snapshot_create rejects a missing/empty targetDir', async () => {
    const missing = parseJson<any>(await handlers.handleSnapshotCreate({}));
    const empty = parseJson<any>(await handlers.handleSnapshotCreate({ targetDir: '   ' }));

    expect(missing.success).toBe(false);
    expect(missing.error).toMatch(/targetDir/);
    expect(empty.success).toBe(false);
  });

  it('snapshot_create normalizes relative traversal paths against the roots', async () => {
    const body = parseJson<any>(
      await handlers.handleSnapshotCreate({
        targetDir: '../../../../../../jshook-not-allowed-snapshot',
      }),
    );

    expect(body.success).toBe(false);
    expect(factoryCalls).toHaveLength(0);
  });

  it('snapshot_list forwards to the manager and returns entries', async () => {
    const body = parseJson<any>(await handlers.handleSnapshotList({ targetDir }));

    expect(body.success).toBe(true);
    expect(body.count).toBe(1);
    expect(body.snapshots[0]).toMatchObject({ id: 'snap-test-2', label: 'latest' });
    expect(fakeManager.list as Mock).toHaveBeenCalledTimes(1);
  });

  it('snapshot_restore forwards the trimmed id and returns revert stats', async () => {
    const body = parseJson<any>(
      await handlers.handleSnapshotRestore({ targetDir, snapshotId: ' snap-test-1 ' }),
    );

    expect(body.success).toBe(true);
    expect(body.snapshotId).toBe('snap-test-1');
    expect(body.restoredFiles).toBe(3);
    expect(body.deletedFiles).toBe(1);
    expect(body.deletedSample).toEqual(['c.txt']);
    expect(body.warning).toMatch(/Full revert semantics/);
    expect(fakeManager.restore as Mock).toHaveBeenCalledWith('snap-test-1');
  });

  it('snapshot_restore requires a snapshotId', async () => {
    const body = parseJson<any>(await handlers.handleSnapshotRestore({ targetDir }));

    expect(body.success).toBe(false);
    expect(body.error).toMatch(/snapshotId/);
    expect(fakeManager.restore as Mock).not.toHaveBeenCalled();
  });

  it('surfaces manager failures as serialized errors', async () => {
    (fakeManager.snapshot as Mock).mockRejectedValueOnce(new Error('git exploded'));

    const body = parseJson<any>(await handlers.handleSnapshotCreate({ targetDir }));

    expect(body.success).toBe(false);
    expect(body.error).toBe('git exploded');
  });

  it('definitions register the three snapshot tools with risk annotations', async () => {
    const { snapshotTools } = await import('@server/domains/maintenance/definitions');
    const names = snapshotTools.map((tool) => tool.name);
    expect(names).toEqual(['snapshot_create', 'snapshot_list', 'snapshot_restore']);

    const restore = snapshotTools.find((tool) => tool.name === 'snapshot_restore');
    expect(restore?.annotations?.destructiveHint).toBe(true);
    expect(restore?.inputSchema.required).toEqual(['targetDir', 'snapshotId']);
    // Risk note must be part of the restore description.
    expect(restore?.description).toMatch(/DELETED/i);

    const list = snapshotTools.find((tool) => tool.name === 'snapshot_list');
    expect(list?.annotations?.readOnlyHint).toBe(true);

    const create = snapshotTools.find((tool) => tool.name === 'snapshot_create');
    expect(create?.description).toMatch(/ISOLATED git object store/i);
    expect(create?.description).toMatch(/\.git/);
  });
});
