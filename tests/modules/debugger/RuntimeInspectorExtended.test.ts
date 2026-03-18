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

import { RuntimeInspector } from '@modules/debugger/RuntimeInspector';
import { PrerequisiteError } from '@errors/PrerequisiteError';

function createSession() {
  return {
    send: vi.fn(async (method: string) => {
      if (method === 'Runtime.getProperties') {
        return {
          result: [{ name: 'x', value: { type: 'number', value: 10 } }],
        };
      }
      if (method === 'Runtime.evaluate') {
        return { result: { type: 'number', value: 42 } };
      }
      return {};
    }),
    on: vi.fn(),
    off: vi.fn(),
    detach: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function createInspector() {
  const session = createSession();
  const page = { createCDPSession: vi.fn().mockResolvedValue(session) };
  const collector = { getActivePage: vi.fn().mockResolvedValue(page) } as any;
  const debuggerManager = {
    getPausedState: vi.fn(),
    evaluateOnCallFrame: vi.fn(),
  } as any;

  const inspector = new RuntimeInspector(collector, debuggerManager);
  return { inspector, session, collector, debuggerManager, page };
}

describe('RuntimeInspector - init and enable lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips double initialization when already enabled', async () => {
    const { inspector, session } = createInspector();

    await inspector.init();
    await inspector.init();

    // Runtime.enable should only be called once
    const enableCalls = session.send.mock.calls.filter((c: any[]) => c[0] === 'Runtime.enable');
    expect(enableCalls).toHaveLength(1);
  });

  it('deduplicates concurrent init calls via initPromise', async () => {
    const { inspector, session } = createInspector();

    const [r1, r2] = await Promise.all([inspector.init(), inspector.init()]);

    expect(r1).toBeUndefined();
    expect(r2).toBeUndefined();
    const enableCalls = session.send.mock.calls.filter((c: any[]) => c[0] === 'Runtime.enable');
    expect(enableCalls).toHaveLength(1);
  });

  it('enable() delegates to init()', async () => {
    const { inspector, session } = createInspector();

    await inspector.enable();

    expect(session.send).toHaveBeenCalledWith('Runtime.enable');
  });

  it('throws and logs error when doInit fails', async () => {
    const { inspector, collector } = createInspector();
    collector.getActivePage.mockRejectedValue(new Error('No page'));

    await expect(inspector.init()).rejects.toThrow('No page');
    expect(loggerState.error).toHaveBeenCalledWith(
      'Failed to enable runtime inspector:',
      expect.any(Error)
    );
  });
});

describe('RuntimeInspector - async stack traces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enables async stack traces with default depth', async () => {
    const { inspector, session } = createInspector();
    await inspector.init();

    await inspector.enableAsyncStackTraces();

    expect(session.send).toHaveBeenCalledWith('Debugger.setAsyncCallStackDepth', {
      maxDepth: 32,
    });
  });

  it('enables async stack traces with custom depth', async () => {
    const { inspector, session } = createInspector();
    await inspector.init();

    await inspector.enableAsyncStackTraces(64);

    expect(session.send).toHaveBeenCalledWith('Debugger.setAsyncCallStackDepth', {
      maxDepth: 64,
    });
  });

  it('throws PrerequisiteError when enableAsyncStackTraces called before init', async () => {
    const { inspector } = createInspector();

    await expect(inspector.enableAsyncStackTraces()).rejects.toBeInstanceOf(PrerequisiteError);
  });

  it('propagates CDP error from enableAsyncStackTraces', async () => {
    const { inspector, session } = createInspector();
    await inspector.init();
    session.send.mockRejectedValueOnce(new Error('CDP error'));

    await expect(inspector.enableAsyncStackTraces()).rejects.toThrow('CDP error');
    expect(loggerState.error).toHaveBeenCalled();
  });

  it('disables async stack traces', async () => {
    const { inspector, session } = createInspector();
    await inspector.init();

    await inspector.disableAsyncStackTraces();

    expect(session.send).toHaveBeenCalledWith('Debugger.setAsyncCallStackDepth', {
      maxDepth: 0,
    });
  });

  it('throws PrerequisiteError when disableAsyncStackTraces called before init', async () => {
    const { inspector } = createInspector();

    await expect(inspector.disableAsyncStackTraces()).rejects.toBeInstanceOf(PrerequisiteError);
  });

  it('propagates CDP error from disableAsyncStackTraces', async () => {
    const { inspector, session } = createInspector();
    await inspector.init();
    session.send.mockRejectedValueOnce(new Error('Detached'));

    await expect(inspector.disableAsyncStackTraces()).rejects.toThrow('Detached');
    expect(loggerState.error).toHaveBeenCalled();
  });
});

describe('RuntimeInspector - disable and close', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('disables and detaches CDP session', async () => {
    const { inspector, session } = createInspector();
    await inspector.init();

    await inspector.disable();

    expect(session.send).toHaveBeenCalledWith('Runtime.disable');
    expect(session.detach).toHaveBeenCalled();
  });

  it('is a no-op when disable called without init', async () => {
    const { inspector, session } = createInspector();

    await inspector.disable();

    expect(session.send).not.toHaveBeenCalled();
    expect(session.detach).not.toHaveBeenCalled();
  });

  it('propagates CDP error on disable failure', async () => {
    const { inspector, session } = createInspector();
    await inspector.init();
    session.send.mockRejectedValueOnce(new Error('Disable failed'));

    await expect(inspector.disable()).rejects.toThrow('Disable failed');
    expect(loggerState.error).toHaveBeenCalled();
  });

  it('close() calls disable when enabled', async () => {
    const { inspector, session } = createInspector();
    await inspector.init();

    await inspector.close();

    expect(session.send).toHaveBeenCalledWith('Runtime.disable');
    expect(loggerState.info).toHaveBeenCalledWith('Runtime inspector closed');
  });

  it('close() detaches dangling CDP session when not enabled', async () => {
    const { inspector } = createInspector();
    // Do not call init, so enabled is false - close should still log
    await inspector.close();

    expect(loggerState.info).toHaveBeenCalledWith('Runtime inspector closed');
  });
});

describe('RuntimeInspector - getCallStack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when debugger is not paused', async () => {
    const { inspector, debuggerManager } = createInspector();
    debuggerManager.getPausedState.mockReturnValue(null);

    const result = await inspector.getCallStack();

    expect(result).toBeNull();
    expect(loggerState.warn).toHaveBeenCalledWith('Not in paused state, cannot get call stack');
  });

  it('maps call frames with anonymous functions', async () => {
    const { inspector, debuggerManager } = createInspector();
    debuggerManager.getPausedState.mockReturnValue({
      callFrames: [
        {
          callFrameId: 'cf-1',
          functionName: '',
          location: { scriptId: 's1', lineNumber: 5, columnNumber: 0 },
          url: 'https://example.com/app.js',
          scopeChain: [{ type: 'local', name: 'localScope' }],
        },
      ],
      reason: 'debugCommand',
      timestamp: 1000,
    });

    const result = await inspector.getCallStack();

    expect(result).not.toBeNull();
    expect(result!.callFrames[0]!.functionName).toBe('(anonymous)');
    expect(result!.callFrames[0]!.scopeChain[0]!.name).toBe('localScope');
    expect(result!.reason).toBe('debugCommand');
  });

  it('maps multiple call frames correctly', async () => {
    const { inspector, debuggerManager } = createInspector();
    debuggerManager.getPausedState.mockReturnValue({
      callFrames: [
        {
          callFrameId: 'cf-1',
          functionName: 'inner',
          location: { scriptId: 's1', lineNumber: 10, columnNumber: 3 },
          url: 'https://example.com/app.js',
          scopeChain: [],
        },
        {
          callFrameId: 'cf-2',
          functionName: 'outer',
          location: { scriptId: 's1', lineNumber: 20, columnNumber: 0 },
          url: 'https://example.com/app.js',
          scopeChain: [{ type: 'global' }],
        },
      ],
      reason: 'breakpoint',
      timestamp: 2000,
    });

    const result = await inspector.getCallStack();

    expect(result!.callFrames).toHaveLength(2);
    expect(loggerState.info).toHaveBeenCalledWith(
      'Call stack retrieved',
      expect.objectContaining({ frameCount: 2, topFrame: 'inner' })
    );
  });
});

describe('RuntimeInspector - getScopeVariables', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws PrerequisiteError when not enabled', async () => {
    const { inspector } = createInspector();

    await expect(inspector.getScopeVariables('cf-1')).rejects.toBeInstanceOf(PrerequisiteError);
  });

  it('throws when callFrameId is empty', async () => {
    const { inspector } = createInspector();
    await inspector.init();

    await expect(inspector.getScopeVariables('')).rejects.toThrow(
      'callFrameId parameter is required'
    );
  });

  it('throws PrerequisiteError when not in paused state', async () => {
    const { inspector, debuggerManager } = createInspector();
    await inspector.init();
    debuggerManager.getPausedState.mockReturnValue(null);

    await expect(inspector.getScopeVariables('cf-1')).rejects.toBeInstanceOf(PrerequisiteError);
  });

  it('throws when call frame is not found', async () => {
    const { inspector, debuggerManager } = createInspector();
    await inspector.init();
    debuggerManager.getPausedState.mockReturnValue({
      callFrames: [{ callFrameId: 'cf-other', scopeChain: [] }],
    });

    await expect(inspector.getScopeVariables('cf-missing')).rejects.toThrow(
      'Call frame not found: cf-missing'
    );
  });

  it('skips scopes without objectId', async () => {
    const { inspector, debuggerManager } = createInspector();
    await inspector.init();
    debuggerManager.getPausedState.mockReturnValue({
      callFrames: [
        {
          callFrameId: 'cf-1',
          scopeChain: [
            { type: 'local', object: { type: 'object' } }, // no objectId
            { type: 'global', object: { type: 'object', objectId: 'obj-g' } },
          ],
        },
      ],
    });

    const result = await inspector.getScopeVariables('cf-1');

    // Only the scope with objectId should appear
    expect(result).toHaveLength(1);
    expect(result[0]!.scopeType).toBe('global');
  });

  it('retrieves and formats properties correctly', async () => {
    const { inspector, debuggerManager, session } = createInspector();
    await inspector.init();
    debuggerManager.getPausedState.mockReturnValue({
      callFrames: [
        {
          callFrameId: 'cf-1',
          scopeChain: [
            { type: 'local', name: 'myScope', object: { type: 'object', objectId: 'obj-1' } },
          ],
        },
      ],
    });
    session.send.mockResolvedValueOnce({
      result: [
        { name: 'count', value: { type: 'number', value: 42 } },
        {
          name: 'obj',
          value: { type: 'object', objectId: 'obj-2', className: 'Foo', description: 'Foo {}' },
        },
        { name: 'empty' }, // no value property - should be skipped
      ],
    });

    const result = await inspector.getScopeVariables('cf-1');

    expect(result).toHaveLength(1);
    expect(result[0]!.scopeName).toBe('myScope');
    expect(result[0]!.variables).toHaveLength(2);
    expect(result[0]!.variables[0]).toMatchObject({
      name: 'count',
      value: 42,
      type: 'number',
    });
    expect(result[0]!.variables[1]).toMatchObject({
      name: 'obj',
      type: 'object',
      objectId: 'obj-2',
      className: 'Foo',
    });
  });
});

describe('RuntimeInspector - getCurrentScopeVariables', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws PrerequisiteError when not paused', async () => {
    const { inspector, debuggerManager } = createInspector();
    await inspector.init();
    debuggerManager.getPausedState.mockReturnValue(null);

    await expect(inspector.getCurrentScopeVariables()).rejects.toBeInstanceOf(PrerequisiteError);
  });

  it('throws PrerequisiteError when callFrames array is empty', async () => {
    const { inspector, debuggerManager } = createInspector();
    await inspector.init();
    debuggerManager.getPausedState.mockReturnValue({
      callFrames: [],
    });

    await expect(inspector.getCurrentScopeVariables()).rejects.toBeInstanceOf(PrerequisiteError);
  });

  it('delegates to getScopeVariables with top frame callFrameId', async () => {
    const { inspector, debuggerManager, session } = createInspector();
    await inspector.init();
    debuggerManager.getPausedState.mockReturnValue({
      callFrames: [
        {
          callFrameId: 'cf-top',
          scopeChain: [{ type: 'local', object: { type: 'object', objectId: 'obj-1' } }],
        },
      ],
    });
    session.send.mockResolvedValueOnce({
      result: [{ name: 'a', value: { type: 'string', value: 'hello' } }],
    });

    const result = await inspector.getCurrentScopeVariables();

    expect(result).toHaveLength(1);
    expect(result[0]!.variables[0]!.name).toBe('a');
  });
});

describe('RuntimeInspector - getObjectProperties', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws PrerequisiteError when not enabled', async () => {
    const { inspector } = createInspector();

    await expect(inspector.getObjectProperties('obj-1')).rejects.toBeInstanceOf(PrerequisiteError);
  });

  it('throws when objectId is empty', async () => {
    const { inspector } = createInspector();
    await inspector.init();

    await expect(inspector.getObjectProperties('')).rejects.toThrow(
      'objectId parameter is required'
    );
  });

  it('retrieves and formats object properties', async () => {
    const { inspector, session } = createInspector();
    await inspector.init();
    session.send.mockResolvedValueOnce({
      result: [
        { name: 'key', value: { type: 'string', value: 'val' } },
        { name: 'noVal' }, // no value - should be skipped
      ],
    });

    const result = await inspector.getObjectProperties('obj-1');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: 'key', value: 'val', type: 'string' });
  });

  it('propagates CDP error from getObjectProperties', async () => {
    const { inspector, session } = createInspector();
    await inspector.init();
    session.send.mockRejectedValueOnce(new Error('Object not found'));

    await expect(inspector.getObjectProperties('obj-bad')).rejects.toThrow('Object not found');
  });
});

describe('RuntimeInspector - evaluate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when expression is empty', async () => {
    const { inspector } = createInspector();

    await expect(inspector.evaluate('')).rejects.toThrow(
      'expression parameter is required and cannot be empty'
    );
  });

  it('throws when expression is whitespace', async () => {
    const { inspector } = createInspector();

    await expect(inspector.evaluate('   ')).rejects.toThrow(
      'expression parameter is required and cannot be empty'
    );
  });

  it('throws PrerequisiteError when not paused', async () => {
    const { inspector, debuggerManager } = createInspector();
    debuggerManager.getPausedState.mockReturnValue(null);

    await expect(inspector.evaluate('x')).rejects.toBeInstanceOf(PrerequisiteError);
  });

  it('throws PrerequisiteError when no call frame available', async () => {
    const { inspector, debuggerManager } = createInspector();
    debuggerManager.getPausedState.mockReturnValue({
      callFrames: [],
    });

    await expect(inspector.evaluate('x')).rejects.toBeInstanceOf(PrerequisiteError);
  });

  it('uses provided callFrameId over top frame', async () => {
    const { inspector, debuggerManager } = createInspector();
    debuggerManager.getPausedState.mockReturnValue({
      callFrames: [{ callFrameId: 'cf-1' }, { callFrameId: 'cf-2' }],
    });
    debuggerManager.evaluateOnCallFrame.mockResolvedValue({ type: 'number', value: 99 });

    await inspector.evaluate('y', 'cf-2');

    expect(debuggerManager.evaluateOnCallFrame).toHaveBeenCalledWith({
      callFrameId: 'cf-2',
      expression: 'y',
      returnByValue: true,
    });
  });

  it('propagates error from evaluateOnCallFrame', async () => {
    const { inspector, debuggerManager } = createInspector();
    debuggerManager.getPausedState.mockReturnValue({
      callFrames: [{ callFrameId: 'cf-1' }],
    });
    debuggerManager.evaluateOnCallFrame.mockRejectedValue(new Error('Eval failed'));

    await expect(inspector.evaluate('badExpr')).rejects.toThrow('Eval failed');
    expect(loggerState.error).toHaveBeenCalled();
  });
});

describe('RuntimeInspector - evaluateGlobal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws PrerequisiteError when not enabled', async () => {
    const { inspector } = createInspector();

    await expect(inspector.evaluateGlobal('1+1')).rejects.toBeInstanceOf(PrerequisiteError);
  });

  it('throws when expression is empty', async () => {
    const { inspector } = createInspector();
    await inspector.init();

    await expect(inspector.evaluateGlobal('')).rejects.toThrow(
      'expression parameter is required and cannot be empty'
    );
  });

  it('throws when expression is whitespace only', async () => {
    const { inspector } = createInspector();
    await inspector.init();

    await expect(inspector.evaluateGlobal('  ')).rejects.toThrow(
      'expression parameter is required and cannot be empty'
    );
  });

  it('propagates CDP error from evaluateGlobal', async () => {
    const { inspector, session } = createInspector();
    await inspector.init();
    session.send.mockRejectedValueOnce(new Error('Runtime error'));

    await expect(inspector.evaluateGlobal('window.foo')).rejects.toThrow('Runtime error');
    expect(loggerState.error).toHaveBeenCalled();
  });
});

describe('RuntimeInspector - formatValue edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('formats undefined type as undefined', async () => {
    const { inspector, debuggerManager } = createInspector();
    debuggerManager.getPausedState.mockReturnValue({
      callFrames: [{ callFrameId: 'cf-1' }],
    });
    debuggerManager.evaluateOnCallFrame.mockResolvedValue({ type: 'undefined' });

    const result = await inspector.evaluate('void 0');

    expect(result).toBeUndefined();
  });

  it('formats null subtype as null', async () => {
    const { inspector, debuggerManager } = createInspector();
    debuggerManager.getPausedState.mockReturnValue({
      callFrames: [{ callFrameId: 'cf-1' }],
    });
    debuggerManager.evaluateOnCallFrame.mockResolvedValue({
      type: 'object',
      subtype: 'null',
    });

    const result = await inspector.evaluate('null');

    expect(result).toBeNull();
  });

  it('returns description when value is missing but description exists', async () => {
    const { inspector, debuggerManager } = createInspector();
    debuggerManager.getPausedState.mockReturnValue({
      callFrames: [{ callFrameId: 'cf-1' }],
    });
    debuggerManager.evaluateOnCallFrame.mockResolvedValue({
      type: 'function',
      description: 'function foo() { ... }',
    });

    const result = await inspector.evaluate('foo');

    expect(result).toBe('function foo() { ... }');
  });

  it('returns [type] string when no value and no description', async () => {
    const { inspector, debuggerManager } = createInspector();
    debuggerManager.getPausedState.mockReturnValue({
      callFrames: [{ callFrameId: 'cf-1' }],
    });
    debuggerManager.evaluateOnCallFrame.mockResolvedValue({
      type: 'symbol',
    });

    const result = await inspector.evaluate('Symbol()');

    expect(result).toBe('[symbol]');
  });

  it('returns [unknown] when type is also missing', async () => {
    const { inspector, debuggerManager } = createInspector();
    debuggerManager.getPausedState.mockReturnValue({
      callFrames: [{ callFrameId: 'cf-1' }],
    });
    debuggerManager.evaluateOnCallFrame.mockResolvedValue({});

    const result = await inspector.evaluate('something');

    expect(result).toBe('[unknown]');
  });

  it('returns primitives directly through formatValue', async () => {
    const { inspector, session } = createInspector();
    await inspector.init();

    // evaluateGlobal with a non-object result.result
    session.send.mockResolvedValueOnce({
      result: { type: 'number', value: 123 },
    });

    const result = await inspector.evaluateGlobal('123');

    expect(result).toBe(123);
  });
});
