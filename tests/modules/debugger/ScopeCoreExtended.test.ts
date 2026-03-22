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

function makePausedCtx(overrides: Record<string, unknown> = {}) {
  const send = vi.fn(async () => ({ result: [] }));
  return {
    enabled: true,
    cdpSession: { send },
    pausedState: {
      callFrames: [
        {
          callFrameId: 'cf-1',
          functionName: 'testFn',
          url: 'https://example.com/app.js',
          location: { lineNumber: 10, columnNumber: 2 },
          scopeChain: [{ type: 'local', object: { objectId: 'obj-local' } }],
        },
      ],
    },
    ...overrides,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  } as any;
}

describe('getScopeVariablesCore - prerequisite checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws PrerequisiteError when not enabled', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const ctx = { enabled: false, cdpSession: null, pausedState: null } as any;
    await expect(getScopeVariablesCore(ctx)).rejects.toBeInstanceOf(PrerequisiteError);
  });

  it('throws PrerequisiteError when cdpSession is null', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const ctx = { enabled: true, cdpSession: null, pausedState: null } as any;
    await expect(getScopeVariablesCore(ctx)).rejects.toBeInstanceOf(PrerequisiteError);
  });

  it('throws PrerequisiteError when not in paused state', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const ctx = { enabled: true, cdpSession: { send: vi.fn() }, pausedState: null } as any;
    await expect(getScopeVariablesCore(ctx)).rejects.toBeInstanceOf(PrerequisiteError);
    await expect(getScopeVariablesCore(ctx)).rejects.toThrow('Not in paused state');
  });
});

describe('getScopeVariablesCore - call frame lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses top frame when no callFrameId specified', async () => {
    const ctx = makePausedCtx();

    const result = await getScopeVariablesCore(ctx);

    expect(result.callFrameId).toBe('cf-1');
    expect(result.callFrameInfo!.functionName).toBe('testFn');
  });

  it('finds specific call frame by callFrameId', async () => {
    const ctx = makePausedCtx({
      pausedState: {
        callFrames: [
          {
            callFrameId: 'cf-1',
            functionName: 'top',
            url: 'https://example.com/a.js',
            location: { lineNumber: 1, columnNumber: 0 },
            scopeChain: [],
          },
          {
            callFrameId: 'cf-2',
            functionName: 'bottom',
            url: 'https://example.com/b.js',
            location: { lineNumber: 20, columnNumber: 5 },
            scopeChain: [],
          },
        ],
      },
    });

    const result = await getScopeVariablesCore(ctx, { callFrameId: 'cf-2' });

    expect(result.callFrameId).toBe('cf-2');
    expect(result.callFrameInfo!.functionName).toBe('bottom');
  });

  it('throws when specified callFrameId is not found', async () => {
    const ctx = makePausedCtx();

    await expect(getScopeVariablesCore(ctx, { callFrameId: 'cf-missing' })).rejects.toThrow(
      'Call frame not found: cf-missing'
    );
  });

  it('throws when there are no call frames at all', async () => {
    const ctx = makePausedCtx({
      pausedState: { callFrames: [] },
    });

    await expect(getScopeVariablesCore(ctx)).rejects.toThrow('Call frame not found: top frame');
  });
});

describe('getScopeVariablesCore - __proto__ filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters out __proto__ properties', async () => {
    const ctx = makePausedCtx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    ctx.cdpSession.send.mockResolvedValueOnce({
      result: [
        { name: '__proto__', value: { type: 'object', value: {} } },
        { name: 'x', value: { type: 'number', value: 5 } },
      ],
    });

    const result = await getScopeVariablesCore(ctx);

    expect(result.variables).toHaveLength(1);
    expect(result.variables[0]!.name).toBe('x');
  });
});

describe('getScopeVariablesCore - scope error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips errored scopes when skipErrors is true (default)', async () => {
    const ctx = makePausedCtx({
      pausedState: {
        callFrames: [
          {
            callFrameId: 'cf-1',
            functionName: 'fn',
            url: 'https://example.com/a.js',
            location: { lineNumber: 1, columnNumber: 0 },
            scopeChain: [
              { type: 'local', object: { objectId: 'obj-good' } },
              { type: 'closure', object: { objectId: 'obj-bad' } },
            ],
          },
        ],
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    ctx.cdpSession.send
      .mockResolvedValueOnce({
        result: [{ name: 'a', value: { type: 'number', value: 1 } }],
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      .mockRejectedValueOnce(new Error('Scope error'));

    const result = await getScopeVariablesCore(ctx);

    expect(result.success).toBe(true);
    expect(result.successfulScopes).toBe(1);
    expect(result.totalScopes).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0]!.scope).toBe('closure');
    expect(result.errors![0]!.error).toBe('Scope error');
  });

  it('throws on scope error when skipErrors is false', async () => {
    const ctx = makePausedCtx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    ctx.cdpSession.send.mockRejectedValueOnce(new Error('Fatal scope error'));

    await expect(getScopeVariablesCore(ctx, { skipErrors: false })).rejects.toThrow(
      'Fatal scope error'
    );
  });

  it('handles non-Error thrown from scope with toErrorMessage', async () => {
    const ctx = makePausedCtx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    ctx.cdpSession.send.mockRejectedValueOnce('string error');

    const result = await getScopeVariablesCore(ctx, { skipErrors: true });

    expect(result.errors).toHaveLength(1);
    expect(result.errors![0]!.error).toBe('string error');
  });

  it('skips scopes without objectId silently', async () => {
    const ctx = makePausedCtx({
      pausedState: {
        callFrames: [
          {
            callFrameId: 'cf-1',
            functionName: 'fn',
            url: 'https://example.com/a.js',
            location: { lineNumber: 1, columnNumber: 0 },
            scopeChain: [
              { type: 'local', object: {} }, // no objectId
              { type: 'global', object: { objectId: 'obj-g' } },
            ],
          },
        ],
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    ctx.cdpSession.send.mockResolvedValueOnce({
      result: [{ name: 'g', value: { type: 'string', value: 'hello' } }],
    });

    const result = await getScopeVariablesCore(ctx);

    expect(result.successfulScopes).toBe(1);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0]!.name).toBe('g');
  });
});

describe('getScopeVariablesCore - nested object properties', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves nested object properties when includeObjectProperties is true', async () => {
    const ctx = makePausedCtx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    ctx.cdpSession.send
      .mockResolvedValueOnce({
        result: [
          {
            name: 'user',
            value: { type: 'object', objectId: 'obj-user' },
            writable: true,
            configurable: true,
            enumerable: true,
          },
        ],
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      .mockResolvedValueOnce({
        result: [{ name: 'name', value: { type: 'string', value: 'Alice' } }],
      });

    // maxDepth=2 because getScopeVariablesCore calls getObjectPropertiesCore(ctx, id, maxDepth - 1)
    // so maxDepth=2 -> nested call gets maxDepth=1, which is > 0 and will fetch properties
    const result = await getScopeVariablesCore(ctx, {
      includeObjectProperties: true,
      maxDepth: 2,
    });

    expect(result.variables).toHaveLength(2);
    expect(result.variables[1]!.name).toBe('user.name');
    expect(result.variables[1]!.value).toBe('Alice');
    expect(result.variables[1]!.scope).toBe('local');
  });

  it('does not resolve nested properties when includeObjectProperties is false', async () => {
    const ctx = makePausedCtx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    ctx.cdpSession.send.mockResolvedValueOnce({
      result: [
        {
          name: 'obj',
          value: { type: 'object', objectId: 'obj-nested' },
        },
      ],
    });

    const result = await getScopeVariablesCore(ctx, {
      includeObjectProperties: false,
    });

    expect(result.variables).toHaveLength(1);
    // Should only have called send once (for the scope)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(ctx.cdpSession.send).toHaveBeenCalledTimes(1);
  });

  it('handles failure in nested property resolution gracefully', async () => {
    const ctx = makePausedCtx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    ctx.cdpSession.send
      .mockResolvedValueOnce({
        result: [
          {
            name: 'data',
            value: { type: 'object', objectId: 'obj-data' },
          },
        ],
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      .mockRejectedValueOnce(new Error('nested fail'));

    const result = await getScopeVariablesCore(ctx, {
      includeObjectProperties: true,
      maxDepth: 2,
    });

    // Main variable should still be present, nested ones are silently dropped
    // getObjectPropertiesCore catches errors internally and returns []
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0]!.name).toBe('data');
    // The debug log comes from getObjectPropertiesCore's internal catch
    expect(loggerState.debug).toHaveBeenCalledWith(
      expect.stringContaining('Failed to get object properties for obj-data'),
      expect.anything()
    );
  });

  it('respects maxDepth=0 and does not resolve nested', async () => {
    const ctx = makePausedCtx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    ctx.cdpSession.send.mockResolvedValueOnce({
      result: [
        {
          name: 'deep',
          value: { type: 'object', objectId: 'obj-deep' },
        },
      ],
    });

    const result = await getScopeVariablesCore(ctx, {
      includeObjectProperties: true,
      maxDepth: 0,
    });

    expect(result.variables).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(ctx.cdpSession.send).toHaveBeenCalledTimes(1);
  });
});

describe('getScopeVariablesCore - callFrameInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses (anonymous) for empty function name', async () => {
    const ctx = makePausedCtx({
      pausedState: {
        callFrames: [
          {
            callFrameId: 'cf-1',
            functionName: '',
            url: 'https://example.com/app.js',
            location: { lineNumber: 5, columnNumber: 3 },
            scopeChain: [],
          },
        ],
      },
    });

    const result = await getScopeVariablesCore(ctx);

    expect(result.callFrameInfo!.functionName).toBe('(anonymous)');
    expect(result.callFrameInfo!.location).toBe('https://example.com/app.js:5:3');
  });
});

describe('getScopeVariablesCore - variable property mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps writable, configurable, enumerable, and objectId fields', async () => {
    const ctx = makePausedCtx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    ctx.cdpSession.send.mockResolvedValueOnce({
      result: [
        {
          name: 'prop',
          value: { type: 'object', value: {}, objectId: 'obj-prop' },
          writable: false,
          configurable: true,
          enumerable: false,
        },
      ],
    });

    const result = await getScopeVariablesCore(ctx);

    const v = result.variables[0]!;
    expect(v.writable).toBe(false);
    expect(v.configurable).toBe(true);
    expect(v.enumerable).toBe(false);
    expect(v.objectId).toBe('obj-prop');
  });

  it('sets type to unknown when prop.value.type is missing', async () => {
    const ctx = makePausedCtx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    ctx.cdpSession.send.mockResolvedValueOnce({
      result: [{ name: 'mystery', value: { value: 'hello' } }],
    });

    const result = await getScopeVariablesCore(ctx);

    expect(result.variables[0]!.type).toBe('unknown');
  });
});

describe('getObjectPropertiesByIdCore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when debugger not enabled', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const ctx = { enabled: false, cdpSession: null } as any;
    await expect(getObjectPropertiesByIdCore(ctx, 'obj-1')).rejects.toThrow('Debugger not enabled');
  });

  it('throws when objectId is empty string', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const ctx = { enabled: true, cdpSession: { send: vi.fn() } } as any;
    await expect(getObjectPropertiesByIdCore(ctx, '')).rejects.toThrow(
      'objectId parameter is required'
    );
  });

  it('throws when objectId is not a string', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const ctx = { enabled: true, cdpSession: { send: vi.fn() } } as any;
    await expect(getObjectPropertiesByIdCore(ctx, 123 as unknown)).rejects.toThrow(
      'objectId parameter is required'
    );
  });

  it('retrieves and maps properties correctly', async () => {
    const send = vi.fn(async () => ({
      result: [
        { name: 'key', value: { type: 'string', value: 'val', description: 'val' } },
        { name: 'count', value: { type: 'number', value: 42 } },
        { name: 'noVal' }, // skipped
      ],
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const ctx = { enabled: true, cdpSession: { send } } as any;

    const result = await getObjectPropertiesByIdCore(ctx, 'obj-1');

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ name: 'key', value: 'val', type: 'string' });
    expect(result[1]).toMatchObject({ name: 'count', value: 42, type: 'number' });
  });

  it('uses description as fallback value when value is undefined', async () => {
    const send = vi.fn(async () => ({
      result: [
        {
          name: 'fn',
          value: { type: 'function', description: 'function foo(){}', className: 'Function' },
        },
      ],
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const ctx = { enabled: true, cdpSession: { send } } as any;

    const result = await getObjectPropertiesByIdCore(ctx, 'obj-fn');

    expect(result[0]!.value).toBe('function foo(){}');
    expect(result[0]!.className).toBe('Function');
  });

  it('maps expired object handle error to stable message', async () => {
    const send = vi.fn(async () => {
      throw new Error('Could not find object with given id');
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const ctx = { enabled: true, cdpSession: { send } } as any;

    await expect(getObjectPropertiesByIdCore(ctx, 'obj-x')).rejects.toThrow(
      'Object handle is expired or invalid'
    );
  });

  it('maps invalid remote object id error to stable message', async () => {
    const send = vi.fn(async () => {
      throw new Error('Invalid remote object id');
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const ctx = { enabled: true, cdpSession: { send } } as any;

    await expect(getObjectPropertiesByIdCore(ctx, 'obj-y')).rejects.toThrow(
      'Object handle is expired or invalid'
    );
  });

  it('re-throws other errors without wrapping', async () => {
    const send = vi.fn(async () => {
      throw new Error('Random CDP error');
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const ctx = { enabled: true, cdpSession: { send } } as any;

    await expect(getObjectPropertiesByIdCore(ctx, 'obj-z')).rejects.toThrow('Random CDP error');
  });

  it('sets type to unknown when prop.value.type is missing', async () => {
    const send = vi.fn(async () => ({
      result: [{ name: 'x', value: { value: 'hello' } }],
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const ctx = { enabled: true, cdpSession: { send } } as any;

    const result = await getObjectPropertiesByIdCore(ctx, 'obj-1');
    expect(result[0]!.type).toBe('unknown');
  });
});

describe('getObjectPropertiesCore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when maxDepth is 0', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const ctx = { enabled: true, cdpSession: { send: vi.fn() } } as any;
    const result = await getObjectPropertiesCore(ctx, 'obj-1', 0);
    expect(result).toEqual([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(ctx.cdpSession.send).not.toHaveBeenCalled();
  });

  it('returns empty array when cdpSession is null', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const ctx = { enabled: true, cdpSession: null } as any;
    const result = await getObjectPropertiesCore(ctx, 'obj-1', 1);
    expect(result).toEqual([]);
  });

  it('filters __proto__ from results', async () => {
    const send = vi.fn(async () => ({
      result: [
        { name: '__proto__', value: { type: 'object' } },
        { name: 'valid', value: { type: 'number', value: 10 } },
      ],
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const ctx = { enabled: true, cdpSession: { send } } as any;

    const result = await getObjectPropertiesCore(ctx, 'obj-1', 1);

    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('valid');
  });

  it('assigns local scope type to all returned variables', async () => {
    const send = vi.fn(async () => ({
      result: [
        { name: 'a', value: { type: 'string', value: 'hello' } },
        { name: 'b', value: { type: 'number', value: 42 } },
      ],
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const ctx = { enabled: true, cdpSession: { send } } as any;

    const result = await getObjectPropertiesCore(ctx, 'obj-1', 1);

    expect(result.every((v: unknown) => v.scope === 'local')).toBe(true);
  });

  it('returns empty array on CDP error', async () => {
    const send = vi.fn(async () => {
      throw new Error('Connection lost');
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const ctx = { enabled: true, cdpSession: { send } } as any;

    const result = await getObjectPropertiesCore(ctx, 'obj-1', 1);

    expect(result).toEqual([]);
    expect(loggerState.debug).toHaveBeenCalledWith(
      expect.stringContaining('Failed to get object properties'),
      expect.anything()
    );
  });

  it('includes objectId in returned variables', async () => {
    const send = vi.fn(async () => ({
      result: [{ name: 'nested', value: { type: 'object', objectId: 'obj-nested', value: {} } }],
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const ctx = { enabled: true, cdpSession: { send } } as any;

    const result = await getObjectPropertiesCore(ctx, 'obj-1', 1);

    expect(result[0]!.objectId).toBe('obj-nested');
  });

  it('sets type to unknown when value.type is missing', async () => {
    const send = vi.fn(async () => ({
      result: [{ name: 'untyped', value: { value: 'data' } }],
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const ctx = { enabled: true, cdpSession: { send } } as any;

    const result = await getObjectPropertiesCore(ctx, 'obj-1', 1);

    expect(result[0]!.type).toBe('unknown');
  });
});
