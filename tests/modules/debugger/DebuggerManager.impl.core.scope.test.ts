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

import { PrerequisiteError } from '@errors/PrerequisiteError';
import {
  getObjectPropertiesByIdCore,
  getObjectPropertiesCore,
  getScopeVariablesCore,
} from '@modules/debugger/DebuggerManager.impl.core.scope';

describe('DebuggerManager scope core helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('collects scope variables and optional nested object properties for the active frame', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        result: [
          {
            name: 'user',
            value: { type: 'object', objectId: 'obj-2', description: 'Object' },
            writable: true,
            configurable: true,
            enumerable: true,
          },
          {
            name: 'count',
            value: { type: 'number', value: 3 },
            writable: true,
            configurable: true,
            enumerable: true,
          },
        ],
      })
      .mockResolvedValueOnce({
        result: [{ name: 'name', value: { type: 'string', value: 'alice' } }],
      });
    const ctx: any = {
      enabled: true,
      cdpSession: { send },
      pausedState: {
        callFrames: [
          {
            callFrameId: 'cf-1',
            functionName: 'main',
            url: 'https://example.com/app.js',
            location: { lineNumber: 10, columnNumber: 2 },
            scopeChain: [{ type: 'local', object: { objectId: 'obj-1' } }],
          },
        ],
      },
    };

    const result = await getScopeVariablesCore(ctx, {
      includeObjectProperties: true,
      maxDepth: 2,
    });

    expect(result.success).toBe(true);
    expect(result.variables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'user', type: 'object', scope: 'local' }),
        expect.objectContaining({ name: 'user.name', value: 'alice', scope: 'local' }),
        expect.objectContaining({ name: 'count', value: 3, type: 'number' }),
      ])
    );
    expect(result.successfulScopes).toBe(1);
  });

  it('maps expired object handles to a stable reacquire message', async () => {
    const ctx: any = {
      enabled: true,
      cdpSession: {
        send: vi.fn(async () => {
          throw new Error('Could not find object with given id');
        }),
      },
      pausedState: null,
    };

    await expect(getObjectPropertiesByIdCore(ctx, 'obj-expired')).rejects.toThrow(
      'Object handle is expired or invalid'
    );
  });

  it('returns safe defaults for nested properties and enforces debugger prerequisites', async () => {
    const ctx: any = {
      enabled: false,
      cdpSession: null,
      pausedState: null,
    };

    await expect(getScopeVariablesCore(ctx)).rejects.toBeInstanceOf(PrerequisiteError);
    expect(await getObjectPropertiesCore(ctx, 'obj-1', 0)).toEqual([]);

    ctx.enabled = true;
    ctx.cdpSession = {
      send: vi.fn(async () => {
        throw new Error('boom');
      }),
    };

    expect(await getObjectPropertiesCore(ctx, 'obj-1', 1)).toEqual([]);
  });
});
