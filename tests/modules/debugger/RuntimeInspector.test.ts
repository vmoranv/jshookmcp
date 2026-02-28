import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { RuntimeInspector } from '../../../src/modules/debugger/RuntimeInspector.js';

function createSession() {
  return {
    send: vi.fn(async (method: string) => {
      if (method === 'Runtime.getProperties') {
        return {
          result: [{ name: 'count', value: { type: 'number', value: 3 } }],
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

describe('RuntimeInspector', () => {
  let session: any;
  let collector: any;
  let debuggerManager: any;
  let inspector: RuntimeInspector;

  beforeEach(() => {
    session = createSession();
    const page = { createCDPSession: vi.fn().mockResolvedValue(session) };
    collector = { getActivePage: vi.fn().mockResolvedValue(page) };
    debuggerManager = {
      getPausedState: vi.fn(),
      evaluateOnCallFrame: vi.fn(),
    };
    inspector = new RuntimeInspector(collector, debuggerManager);
  });

  it('initializes runtime domain and enables inspector', async () => {
    await inspector.init();
    expect(session.send).toHaveBeenCalledWith('Runtime.enable');
  });

  it('throws when enabling async stack traces before init', async () => {
    await expect(inspector.enableAsyncStackTraces()).rejects.toThrow('Runtime inspector not enabled');
  });

  it('returns null call stack when debugger is not paused', async () => {
    debuggerManager.getPausedState.mockReturnValue(null);
    await expect(inspector.getCallStack()).resolves.toBeNull();
  });

  it('retrieves scope variables for paused call frame', async () => {
    await inspector.init();
    debuggerManager.getPausedState.mockReturnValue({
      reason: 'breakpoint',
      timestamp: Date.now(),
      callFrames: [
        {
          callFrameId: 'cf-1',
          functionName: 'main',
          location: { scriptId: 's1', lineNumber: 1, columnNumber: 1 },
          url: 'https://site/app.js',
          scopeChain: [{ type: 'local', object: { type: 'object', objectId: 'obj-1' } }],
        },
      ],
    });

    const result = await inspector.getScopeVariables('cf-1');
    expect(result).toHaveLength(1);
    expect(result[0]?.scopeType).toBe('local');
    expect(result[0]?.variables[0]?.name).toBe('count');
  });

  it('evaluates expression on paused call frame via debugger manager', async () => {
    debuggerManager.getPausedState.mockReturnValue({
      callFrames: [{ callFrameId: 'cf-1' }],
    });
    debuggerManager.evaluateOnCallFrame.mockResolvedValue({ type: 'number', value: 7 });

    const value = await inspector.evaluate('x + 1');
    expect(value).toBe(7);
    expect(debuggerManager.evaluateOnCallFrame).toHaveBeenCalledWith({
      callFrameId: 'cf-1',
      expression: 'x + 1',
      returnByValue: true,
    });
  });

  it('evaluates global expression when runtime is enabled', async () => {
    await inspector.init();
    const value = await inspector.evaluateGlobal('6 * 7');

    expect(value).toBe(42);
    expect(session.send).toHaveBeenCalledWith('Runtime.evaluate', {
      expression: '6 * 7',
      returnByValue: true,
    });
  });
});

