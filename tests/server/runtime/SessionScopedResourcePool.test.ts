import { describe, expect, it, vi } from 'vitest';
import {
  SessionScopedResourcePool,
  SessionScopedResourcePoolCapacityError,
} from '@server/runtime/SessionScopedResourcePool';
import { runWithToolRequestContext } from '@server/runtime/ToolRequestContext';

class TestResource {
  readonly sessionId: string;
  readonly values: string[] = [];

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  add(value: string): string {
    this.values.push(value);
    return this.sessionId;
  }

  async wait(gate: Promise<void>): Promise<string> {
    await gate;
    return this.sessionId;
  }
}

describe('SessionScopedResourcePool', () => {
  it('routes a stable proxy to ten isolated session resources', async () => {
    const dispose = vi.fn(async (_resource: TestResource) => undefined);
    const pool = new SessionScopedResourcePool((sessionId) => new TestResource(sessionId), dispose);
    const proxy = pool.getProxy();
    const sessionIds = Array.from({ length: 10 }, (_, index) => `session-${index}`);

    const routedSessionIds = await Promise.all(
      sessionIds.map(
        async (sessionId) =>
          await runWithToolRequestContext({ sessionId }, async () => proxy.add(sessionId)),
      ),
    );

    expect(routedSessionIds).toEqual(sessionIds);
    expect(pool.size).toBe(11); // ten HTTP sessions plus the stdio/default proxy target
    for (const sessionId of sessionIds) {
      expect(pool.getForSession(sessionId).values).toEqual([sessionId]);
    }

    expect(await pool.dropSession('session-4')).toBe(true);
    expect(dispose).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-4' }));
    expect(pool.has('session-4')).toBe(false);
    await pool.close();
  });

  it('bounds the local working set and evicts only idle expired resources', async () => {
    let now = 0;
    const dispose = vi.fn(async (_resource: TestResource) => undefined);
    const pool = new SessionScopedResourcePool(
      (sessionId) => new TestResource(sessionId),
      dispose,
      { maxResources: 2, idleTtlMs: 100, now: () => now },
    );
    pool.getForSession('session-a');
    pool.getForSession('session-b');

    expect(() => pool.getForSession('session-c')).toThrowError(
      SessionScopedResourcePoolCapacityError,
    );
    expect(pool.getStats()).toMatchObject({ size: 2, maxResources: 2, inFlight: 0 });

    now = 101;
    expect(pool.getForSession('session-c').sessionId).toBe('session-c');
    expect(pool.size).toBe(2);
    expect(dispose).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-a' }));
  });

  it('re-resolves the resource when a captured proxy method runs after dropSession', async () => {
    const created: TestResource[] = [];
    const dispose = vi.fn(async (_resource: TestResource) => undefined);
    const pool = new SessionScopedResourcePool((sessionId) => {
      const resource = new TestResource(sessionId);
      created.push(resource);
      return resource;
    }, dispose);
    const proxy = pool.getProxy();

    // Reading the method captures the current (session-a) entry; the callback
    // itself must resolve again at call time.
    const add = await runWithToolRequestContext({ sessionId: 'session-a' }, async () => proxy.add);

    expect(await pool.dropSession('session-a')).toBe(true);
    expect(dispose).toHaveBeenCalledTimes(1);

    const returned = await runWithToolRequestContext({ sessionId: 'session-a' }, async () =>
      add('after-drop'),
    );

    expect(returned).toBe('session-a');
    const sessionResources = created.filter((resource) => resource.sessionId === 'session-a');
    expect(sessionResources).toHaveLength(2);
    expect(sessionResources[0]!.values).toEqual([]);
    expect(sessionResources[1]!.values).toEqual(['after-drop']);
    await pool.close();
  });

  it('defers disposal until an in-flight session method settles', async () => {
    const dispose = vi.fn(async (_resource: TestResource) => undefined);
    const pool = new SessionScopedResourcePool((sessionId) => new TestResource(sessionId), dispose);
    const proxy = pool.getProxy();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const active = runWithToolRequestContext({ sessionId: 'session-a' }, async () =>
      proxy.wait(gate),
    );

    expect(pool.getStats().inFlight).toBe(1);
    expect(await pool.dropSession('session-a')).toBe(true);
    expect(dispose).not.toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-a' }));

    release();
    await expect(active).resolves.toBe('session-a');
    expect(dispose).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-a' }));
  });
});
