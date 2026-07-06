import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import manifest from '@server/domains/coordination/manifest';

describe('coordination manifest', () => {
  it('registers coordination and state-board snapshot sources once', async () => {
    const stateDir = resolve('tmp-state');
    const scheduler = {
      register: vi.fn(),
      notifyDirty: vi.fn(),
    };
    const instances = new Map<string, unknown>([
      ['snapshotScheduler', scheduler],
      ['snapshotStateDir', stateDir],
    ]);
    const ctx = {
      getDomainInstance: <T>(key: string) => instances.get(key) as T,
      setDomainInstance: (key: string, value: unknown) => instances.set(key, value),
    } as any;

    const handler = await manifest.ensure(ctx);

    expect(scheduler.register).toHaveBeenCalledWith(
      resolve(stateDir, 'coordination', 'current.json'),
      handler,
    );
    expect(scheduler.register).toHaveBeenCalledWith(
      resolve(stateDir, 'state-board', 'current.json'),
      expect.anything(),
    );
    expect(instances.get('coordinationSnapshotRegistered')).toBe(true);

    await handler.handleCreateTaskHandoff({ description: 'notify scheduler' });
    expect(scheduler.notifyDirty).toHaveBeenCalled();

    await manifest.ensure(ctx);
    expect(scheduler.register).toHaveBeenCalledTimes(2);
  });
});
