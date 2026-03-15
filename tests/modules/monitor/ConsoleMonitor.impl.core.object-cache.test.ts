import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

import {
  clearObjectCacheCore,
  inspectObjectCore,
} from '@modules/monitor/ConsoleMonitor.impl.core.object-cache';

describe('ConsoleMonitor object cache helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inspects objects through CDP, normalizes property values and caches the result', async () => {
    const send = vi.fn(async () => ({
      result: [
        { name: 'count', value: { type: 'number', value: 3 } },
        { name: 'nested', value: { type: 'object', objectId: 'obj-2', description: 'Object' } },
      ],
    }));
    const ctx = {
      ensureSession: vi.fn(async () => {}),
      cdpSession: { send },
      objectCache: new Map(),
      MAX_OBJECT_CACHE_SIZE: 2,
      extractValue: vi.fn((value: any) => value.value ?? `[${value.type}]`),
    };

    const first = await inspectObjectCore(ctx, 'obj-1');
    const second = await inspectObjectCore(ctx, 'obj-1');

    expect(first).toEqual({
      count: { value: 3, type: 'number', objectId: undefined, description: undefined },
      nested: { value: '[object]', type: 'object', objectId: 'obj-2', description: 'Object' },
    });
    expect(second).toBe(first);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('evicts the oldest cached entry when the cache is at capacity and can be cleared', async () => {
    const send = vi.fn(async ({ objectId }: any) => ({
      result: [{ name: 'id', value: { type: 'string', value: objectId } }],
    }));
    const ctx = {
      ensureSession: vi.fn(async () => {}),
      cdpSession: { send: vi.fn(async (_method: string, params: any) => send(params)) },
      objectCache: new Map<string, Record<string, unknown>>([
        ['oldest', { id: { value: 'oldest', type: 'string' } }],
      ]),
      MAX_OBJECT_CACHE_SIZE: 1,
      extractValue: vi.fn((value: any) => value.value),
    };

    await inspectObjectCore(ctx, 'new-object');

    expect(ctx.objectCache.has('oldest')).toBe(false);
    expect(ctx.objectCache.has('new-object')).toBe(true);

    clearObjectCacheCore(ctx);
    expect(ctx.objectCache.size).toBe(0);
    expect(loggerState.info).toHaveBeenCalled();
  });
});
